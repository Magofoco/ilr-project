import { z } from 'zod';

// ============================================
// SHARED ENUMS
// ============================================

export const serviceTierSchema = z.enum(['standard', 'priority', 'super_priority']);
export type ServiceTier = z.infer<typeof serviceTierSchema>;

export const outcomeSchema = z.enum(['approved', 'rejected', 'pending', 'unknown']);
export type Outcome = z.infer<typeof outcomeSchema>;

export const caseEventTypeSchema = z.enum([
  'applied',
  'biometrics',
  'acknowledgement',
  'docs_requested',
  'docs_submitted',
  'decision',
]);
export type CaseEventType = z.infer<typeof caseEventTypeSchema>;

// ============================================
// SOURCE FORUM SCHEMAS
// ============================================

export const sourceForumSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  type: z.enum(['playwright', 'fetch']),
  config: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createSourceForumSchema = sourceForumSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSourceForumSchema = createSourceForumSchema.partial();

// ============================================
// CASE EVENT SCHEMAS
// ============================================

export const caseEventSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  type: caseEventTypeSchema,
  eventDate: z.coerce.date(),
  confidence: z.number().min(0).max(1),
  createdAt: z.coerce.date(),
});

// ============================================
// EXTRACTED CASE SCHEMAS
// ============================================

export const extractedCaseSchema = z.object({
  id: z.string(),
  postId: z.string(),

  applicationType: z.string().nullable(),
  applicationRoute: z.string().nullable(),
  serviceTier: serviceTierSchema.nullable(),

  applicationDate: z.coerce.date().nullable(),
  biometricsDate: z.coerce.date().nullable(),
  docsRequestedDate: z.coerce.date().nullable(),
  docsSubmittedDate: z.coerce.date().nullable(),
  decisionDate: z.coerce.date().nullable(),
  waitingDays: z.number().int().nullable(),

  biometricsLocation: z.string().nullable(),
  decisionCenter: z.string().nullable(),

  applicantNationality: z.string().nullable(),
  applicantNationalityCode: z.string().nullable(),

  outcome: outcomeSchema.nullable(),
  isPending: z.boolean(),

  confidence: z.number().min(0).max(1),
  extractionNotes: z.string().nullable(),
  extractedAt: z.coerce.date(),
  extractorVersion: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================
// QUERY SCHEMAS
// ============================================

export const casesQuerySchema = z.object({
  // Filters
  applicationRoute: z.string().optional(),
  applicationType: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  biometricsLocation: z.string().optional(),
  applicantNationalityCode: z.string().length(2).optional(),
  outcome: outcomeSchema.optional(),
  sourceId: z.string().optional(),

  // Date range
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),

  // Confidence threshold
  minConfidence: z.coerce.number().min(0).max(1).optional(),

  // Pagination
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),

  // Sorting
  sortBy: z.enum(['applicationDate', 'decisionDate', 'waitingDays', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// ESTIMATE SCHEMAS (the flagship endpoint)
// ============================================

export const estimateQuerySchema = z.object({
  // All filters are optional — the engine relaxes when the cohort is too small.
  applicantNationalityCode: z.string().length(2).optional(),
  applicationRoute: z.string().optional(),
  biometricsLocation: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),

  // For "where am I right now" view: when the user already applied.
  applicationDate: z.coerce.date().optional(),

  // Optional time-window for the cohort (decisions within last N days).
  // Defaults to 730 (last 2 years) — Brexit/COVID era cases are too different.
  windowDays: z.coerce.number().int().positive().max(3650).default(730),

  // Minimum cohort size before we start returning estimates. Below this,
  // we relax filters until we hit it (or run out of relaxations).
  minCohortSize: z.coerce.number().int().positive().max(500).default(30),
});

export const estimatePercentilesSchema = z.object({
  p10: z.number().nullable(),
  p25: z.number().nullable(),
  median: z.number().nullable(),
  p75: z.number().nullable(),
  p90: z.number().nullable(),
});

export const kmCurvePointSchema = z.object({
  day: z.number().int().nonnegative(),
  // Survival function S(t): fraction still waiting at this day.
  survival: z.number().min(0).max(1),
  // Number of cases at risk at this day.
  atRisk: z.number().int().nonnegative(),
  // Number of decisions on this day.
  events: z.number().int().nonnegative(),
});

export const cohortRelaxationStepSchema = z.object({
  // The filter that was dropped, e.g. "biometricsLocation" or "applicantNationalityCode".
  droppedFilter: z.string(),
  // Cohort size before / after this relaxation step.
  cohortBefore: z.number().int().nonnegative(),
  cohortAfter: z.number().int().nonnegative(),
});

export const comparableCaseSchema = z.object({
  id: z.string(),
  applicationRoute: z.string().nullable(),
  serviceTier: serviceTierSchema.nullable(),
  biometricsLocation: z.string().nullable(),
  applicantNationalityCode: z.string().nullable(),
  applicationDate: z.coerce.date().nullable(),
  decisionDate: z.coerce.date().nullable(),
  waitingDays: z.number().int().nullable(),
  outcome: outcomeSchema.nullable(),
  isPending: z.boolean(),
  // Source URL for transparency. Username is intentionally not included.
  sourceUrl: z.string().url(),
  confidence: z.number().min(0).max(1),
});

export const estimateResponseSchema = z.object({
  // Final cohort size used to compute the estimate.
  cohortSize: z.number().int().nonnegative(),
  // Final filter set after any relaxation.
  filtersApplied: z.object({
    applicantNationalityCode: z.string().nullable(),
    applicationRoute: z.string().nullable(),
    biometricsLocation: z.string().nullable(),
    serviceTier: serviceTierSchema.nullable(),
    windowDays: z.number().int().positive(),
  }),
  // Steps taken to reach the final cohort (empty if exact cohort was usable).
  cohortRelaxation: z.array(cohortRelaxationStepSchema),
  // Kaplan–Meier survival percentiles, in days.
  // null entries mean the curve never crossed that quantile (e.g., too many pending).
  percentiles: estimatePercentilesSchema,
  // Approval rate among _decided_ cases in the cohort. Null if too few decided.
  approvalRate: z.number().min(0).max(1).nullable(),
  // Number of decided vs pending in the cohort, for transparency.
  decidedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  // Sampled K-M curve points (subsampled for transport — typically <= 200 points).
  kmCurve: z.array(kmCurvePointSchema),
  // Conditional view: only present if applicationDate was provided.
  // "You're at day 73; X% of comparable cases had a decision by now,
  //  conditional median remaining wait is Y days."
  conditional: z
    .object({
      currentDay: z.number().int().nonnegative(),
      // P(decided by today | wait ≥ 0): 1 - S(currentDay).
      decidedByNowFraction: z.number().min(0).max(1),
      // Conditional median additional wait (days), or null if unestimable.
      conditionalMedianRemaining: z.number().nullable(),
    })
    .nullable(),
  // A handful of anonymized comparable cases for the user to inspect.
  comparableCases: z.array(comparableCaseSchema),
  // Honest disclosure block.
  disclaimers: z.array(z.string()),
});

export type EstimateQuery = z.infer<typeof estimateQuerySchema>;
export type EstimateResponse = z.infer<typeof estimateResponseSchema>;
export type ComparableCase = z.infer<typeof comparableCaseSchema>;
export type KmCurvePoint = z.infer<typeof kmCurvePointSchema>;
export type CohortRelaxationStep = z.infer<typeof cohortRelaxationStepSchema>;

// ============================================
// STATS SCHEMAS
// ============================================

export const overviewStatsSchema = z.object({
  totalCases: z.number(),
  casesLast30Days: z.number(),
  // Median is now Kaplan–Meier-based: includes pending cases as right-censored.
  // Null only when the cohort is too small or never crosses 50% on the curve.
  medianWaitingDays: z.number().nullable(),
  // Average is intentionally only over decided cases (it's biased — exposed for transparency).
  averageWaitingDaysDecided: z.number().nullable(),
  approvalRate: z.number().nullable(), // Percentage 0..100
  decidedCount: z.number(),
  pendingCount: z.number(),
  byRoute: z.array(z.object({
    route: z.string(),
    count: z.number(),
    medianDays: z.number().nullable(),
  })),
  byMonth: z.array(z.object({
    month: z.string(), // YYYY-MM format
    count: z.number(),
    medianDays: z.number().nullable(),
  })),
});

// ============================================
// SCRAPE RUN SCHEMAS
// ============================================

export const scrapeRunSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  status: z.enum(['running', 'completed', 'partial', 'failed']),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  threadsFound: z.number(),
  threadsScraped: z.number(),
  postsFound: z.number(),
  postsScraped: z.number(),
  casesExtracted: z.number(),
  errorMessage: z.string().nullable(),
});

export const triggerScrapeSchema = z.object({
  sourceId: z.string(),
  since: z.coerce.date().optional(),
  maxThreads: z.number().int().positive().optional(),
});

// ============================================
// AUTH SCHEMAS
// ============================================

export const userRoleSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(['user', 'admin']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================
// API RESPONSE SCHEMAS
// ============================================

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  });

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});
