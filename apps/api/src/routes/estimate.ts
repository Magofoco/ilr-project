import type { FastifyInstance } from 'fastify';
import {
  estimateQuerySchema,
  kaplanMeier,
  kmPercentile,
  kmDecidedByDayFraction,
  kmConditionalMedian,
  type EstimateResponse,
  type EstimateTier,
  type ServiceTier,
} from '@ilr/shared';
import {
  buildKmInputs,
  computeApprovalRate,
  loadCohort,
  subsampleKm,
  type CohortFilters,
  type CohortRecord,
} from '../lib/cohort.js';
import { hasIlrTrackerEntitlement } from '../lib/entitlements.js';

/** Maximum comparable cases visible to free-tier users. */
const FREE_TIER_COMPARABLES = 5;

/**
 * k-anonymity floor for the comparable-cases LIST (per AGENTS.md). Below
 * this size we don't expose individual case rows — even though every row
 * is anonymized to source URL only, a list this small could in theory help
 * narrow down which forum poster it came from. The summary statistics
 * (median, cohort size, etc.) are still shown.
 */
const COMPARABLE_CASES_K_ANONYMITY = 5;

/**
 * Cohort-size threshold below which we show a "small cohort, treat as
 * directional only" disclaimer. This is purely a UI warning — the estimate
 * is still computed and shown. Kept independent of `minCohortSize` (which
 * now defaults to 1, controlling relaxation) so the disclaimer behavior
 * doesn't drift with a knob the caller can tweak.
 */
const SMALL_COHORT_THRESHOLD = 30;

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Filter relaxation order. When the exact cohort is too small, we drop
 * filters one at a time, in this order — the most-specific (and most
 * variance-reducing) filter is dropped LAST, because we'd rather widen
 * geography or service tier before nationality or route.
 *
 * Order rationale (least → most predictive of wait time):
 *   1. biometricsLocation — modest signal
 *   2. serviceTier        — strong signal but typically obvious to user
 *   3. applicantNationalityCode — strong (security checks differ)
 *   4. applicationRoute   — strongest (different statutory schemes)
 */
const RELAXATION_ORDER = [
  'biometricsLocation',
  'serviceTier',
  'applicantNationalityCode',
  'applicationRoute',
] as const;

type RelaxableField = (typeof RELAXATION_ORDER)[number];

interface RelaxationStep {
  droppedFilter: RelaxableField;
  cohortBefore: number;
  cohortAfter: number;
}

interface CohortResolution {
  cohort: CohortRecord[];
  filtersApplied: CohortFilters;
  relaxation: RelaxationStep[];
}

/**
 * Find the smallest cohort that meets `minCohortSize`, relaxing filters one
 * at a time in `RELAXATION_ORDER`. Returns the final cohort (could still be
 * smaller than the threshold if no relaxation helped).
 */
async function resolveCohort(
  initial: CohortFilters,
  minCohortSize: number,
  now: Date
): Promise<CohortResolution> {
  const filters: CohortFilters = { ...initial };
  let cohort = await loadCohort(filters, now);
  const relaxation: RelaxationStep[] = [];

  for (const field of RELAXATION_ORDER) {
    if (cohort.length >= minCohortSize) break;
    if (filters[field] === undefined || filters[field] === null) continue;

    const before = cohort.length;
    filters[field] = null;
    cohort = await loadCohort(filters, now);
    relaxation.push({ droppedFilter: field, cohortBefore: before, cohortAfter: cohort.length });
  }

  return { cohort, filtersApplied: filters, relaxation };
}

export async function estimateRoutes(fastify: FastifyInstance) {
  /**
   * POST /estimate
   *
   * The flagship endpoint. Given filters (any subset), returns:
   *   - cohort size, approval rate, percentiles
   *   - Kaplan–Meier survival curve (subsampled)
   *   - "where am I now" conditional view (if applicationDate provided)
   *   - sample comparable cases for transparency
   *   - cohort relaxation chain so the user can see what filters were dropped
   */
  fastify.post('/', async (request, reply): Promise<EstimateResponse | { error: string; message: string; statusCode: number }> => {
    const parsed = estimateQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        statusCode: 400,
      });
    }
    const query = parsed.data;
    const now = new Date();

    // verifyJwt (registered on this scope in index.ts) has already populated
    // request.user — if it weren't set, the request would have 401ed before
    // hitting this handler.
    const userId = request.user?.id;
    const tier: EstimateTier =
      userId && (await hasIlrTrackerEntitlement(userId)) ? 'paid' : 'free';

    // Build initial cohort filters from the query.
    const initial: CohortFilters = {
      applicantNationalityCode: query.applicantNationalityCode ?? null,
      applicationRoute: query.applicationRoute ?? null,
      biometricsLocation: query.biometricsLocation ?? null,
      serviceTier: (query.serviceTier as ServiceTier | undefined) ?? null,
      windowDays: query.windowDays,
    };

    const { cohort, filtersApplied, relaxation } = await resolveCohort(
      initial,
      query.minCohortSize,
      now
    );

    const kmInputs = buildKmInputs(cohort, now);
    const km = kaplanMeier(kmInputs);

    const percentiles = {
      p10: kmPercentile(km, 0.1),
      p25: kmPercentile(km, 0.25),
      median: kmPercentile(km, 0.5),
      p75: kmPercentile(km, 0.75),
      p90: kmPercentile(km, 0.9),
    };

    const approvalFraction = computeApprovalRate(cohort);

    // Conditional view if the user has already applied.
    let conditional: EstimateResponse['conditional'] = null;
    if (query.applicationDate) {
      const currentDay = Math.max(
        0,
        Math.round((now.getTime() - query.applicationDate.getTime()) / DAY_MS)
      );
      conditional = {
        currentDay,
        decidedByNowFraction: kmDecidedByDayFraction(km, currentDay),
        conditionalMedianRemaining: kmConditionalMedian(km, currentDay),
      };
    }

    // Sample up to 20 comparable cases — bias the sample toward the
    // applicant's own circumstances by sorting by recency. Usernames are
    // intentionally NOT included; only the source thread URL.
    //
    // Free tier sees the first FREE_TIER_COMPARABLES rows; this is enforced
    // at the API level (not just hidden in the UI) so a determined user
    // hitting the endpoint directly can't bypass the paywall.
    //
    // k-anonymity: if the cohort is smaller than COMPARABLE_CASES_K_ANONYMITY,
    // we suppress the LIST entirely (empty array). The summary statistics
    // are still safe to return.
    const comparableLimit = tier === 'paid' ? 20 : FREE_TIER_COMPARABLES;
    const comparableCases: EstimateResponse['comparableCases'] =
      cohort.length < COMPARABLE_CASES_K_ANONYMITY
        ? []
        : cohort
            .slice()
            .sort((a, b) => b.applicationDate.getTime() - a.applicationDate.getTime())
            .slice(0, comparableLimit)
            .map((r) => ({
              id: r.id,
              applicationRoute: r.applicationRoute,
              serviceTier: r.serviceTier,
              biometricsLocation: r.biometricsLocation,
              applicantNationalityCode: r.applicantNationalityCode,
              applicationDate: r.applicationDate,
              decisionDate: r.decisionDate,
              waitingDays: r.decisionDate
                ? Math.round(
                    (r.decisionDate.getTime() - r.applicationDate.getTime()) / DAY_MS,
                  )
                : null,
              outcome:
                (r.outcome as EstimateResponse['comparableCases'][number]['outcome']) ??
                null,
              isPending: r.isPending,
              sourceUrls: r.sourceUrls,
              contributingPostCount: r.contributingPostCount,
              confidence: r.confidence,
            }));

    const subsampled = subsampleKm(km);

    const disclaimers = buildDisclaimers({
      cohortSize: cohort.length,
      decidedCount: km.decidedCount,
      pendingCount: km.censoredCount,
      relaxation,
      hasApprovalRate: approvalFraction !== null,
      comparableCasesHidden:
        cohort.length > 0 && cohort.length < COMPARABLE_CASES_K_ANONYMITY,
    });

    // Build the full response, then redact premium fields for free tier.
    // Redaction happens here (not in the helpers above) so that paid users
    // get the same compute path — keeping their slice-of-life identical to
    // free helps catch any regressions in the redaction layer.
    const fullResponse: EstimateResponse = {
      tier,
      cohortSize: cohort.length,
      filtersApplied: {
        applicantNationalityCode: filtersApplied.applicantNationalityCode ?? null,
        applicationRoute: filtersApplied.applicationRoute ?? null,
        biometricsLocation: filtersApplied.biometricsLocation ?? null,
        serviceTier: filtersApplied.serviceTier ?? null,
        windowDays: filtersApplied.windowDays ?? query.windowDays,
      },
      cohortRelaxation: relaxation,
      percentiles,
      approvalRate: approvalFraction,
      decidedCount: km.decidedCount,
      pendingCount: km.censoredCount,
      kmCurve: subsampled.points.map((p) => ({
        day: p.day,
        survival: p.survival,
        atRisk: p.atRisk,
        events: p.events,
      })),
      conditional,
      comparableCases,
      disclaimers,
    };

    if (tier === 'paid') return fullResponse;

    // Free-tier redaction: keep the cohort median visible (the lone headline
    // number we promised in the marketing), strip everything else premium.
    // We deliberately keep cohortRelaxation + filtersApplied + disclaimers
    // visible — the product's USP is calibrated honesty, and those are part
    // of that honesty regardless of who's paying.
    const freeResponse: EstimateResponse = {
      ...fullResponse,
      percentiles: {
        p10: null,
        p25: null,
        median: percentiles.median,
        p75: null,
        p90: null,
      },
      approvalRate: null,
      kmCurve: [],
      conditional: null,
    };
    return freeResponse;
  });
}

interface DisclaimerInputs {
  cohortSize: number;
  decidedCount: number;
  pendingCount: number;
  relaxation: RelaxationStep[];
  hasApprovalRate: boolean;
  /** True if we suppressed the comparable-cases list under k-anonymity. */
  comparableCasesHidden: boolean;
}

/**
 * Honest disclaimers about the estimate. We deliberately enumerate them
 * here rather than only in UI text so the API response is self-describing.
 */
function buildDisclaimers(inputs: DisclaimerInputs): string[] {
  const out: string[] = [];

  if (inputs.cohortSize > 0 && inputs.cohortSize < SMALL_COHORT_THRESHOLD) {
    const noun = inputs.cohortSize === 1 ? 'case' : 'cases';
    out.push(
      `Cohort is small (${inputs.cohortSize} ${noun}). Treat as directional only — uncertainty is wide.`,
    );
  }

  if (inputs.relaxation.length > 0) {
    const dropped = inputs.relaxation.map((r) => r.droppedFilter).join(', ');
    out.push(
      `No exact matches for your filters, so we relaxed them (dropped: ${dropped}). The estimate reflects a wider group than the one you specified.`,
    );
  }

  if (inputs.pendingCount > inputs.decidedCount) {
    out.push(
      'More than half of comparable cases are still pending. Median wait may shift as those cases resolve.',
    );
  }

  if (!inputs.hasApprovalRate) {
    out.push(
      'Too few decided cases to report a reliable approval rate; this is omitted rather than guessed.',
    );
  }

  if (inputs.comparableCasesHidden) {
    out.push(
      `Individual comparable cases are hidden when the cohort has fewer than ${COMPARABLE_CASES_K_ANONYMITY} people, to protect forum posters\u2019 anonymity. The summary numbers still reflect your full cohort.`,
    );
  }

  out.push(
    'Source data comes from public forums and is biased: applicants with unusually short or long waits are over-represented. Treat this as a directional signal, not a guarantee.',
  );

  return out;
}
