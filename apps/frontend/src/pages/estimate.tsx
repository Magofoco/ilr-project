import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTip } from '@/components/ui/info-tip';
import { api, ApiError } from '@/lib/api';
import { cn, formatDate, formatDays } from '@/lib/utils';
import type { EstimateResponse, ServiceTier } from '@ilr/shared';
import { getCountryName } from '@ilr/shared';
import {
  ArrowDown,
  Calculator,
  Calendar,
  ExternalLink,
  Hourglass,
  Lock,
  SearchX,
  ShieldAlert,
  Sparkles,
  TrendingDown,
} from 'lucide-react';

// ============================================
// CONSTANTS
// ============================================

const ALL_VALUE = '__all__';

// Hard-coded fallback for the service-tier dropdown (the API supports it
// but doesn't always have every value populated in the cohort).
const SERVICE_TIERS: { value: ServiceTier; label: string; help: string }[] = [
  {
    value: 'standard',
    label: 'Standard',
    help: 'No extra fee — slowest queue, the default.',
  },
  {
    value: 'priority',
    label: 'Priority',
    help: '\u00A3500 add-on, ~5 working day target.',
  },
  {
    value: 'super_priority',
    label: 'Super Priority',
    help: '\u00A31,000 add-on, next working day target.',
  },
];

// The estimator deliberately omits Super Priority by default — its <24h wait
// distribution skews the median massively. The user can opt in via the form.
const DAY_MS = 1000 * 60 * 60 * 24;

interface FiltersResponse {
  applicationRoutes: string[];
  applicationTypes: string[];
  biometricsLocations: string[];
  serviceTiers: string[];
  nationalityCodes: string[];
  sources: { id: string; name: string; displayName: string }[];
}

interface FormState {
  applicationRoute: string;
  biometricsLocation: string;
  serviceTier: '' | ServiceTier;
  applicantNationalityCode: string;
  applicationDate: string; // yyyy-mm-dd or ''
}

const EMPTY_FORM: FormState = {
  applicationRoute: '',
  biometricsLocation: '',
  serviceTier: '',
  applicantNationalityCode: '',
  applicationDate: '',
};

// ============================================
// PAGE
// ============================================

export function Estimate() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Whether the user has ever submitted — used to swap the empty-state copy
  // for the results panel after the first run.
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Anchor we scroll to after a successful submit on small screens, where the
  // results render below the form and would otherwise be off-screen.
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const { data: filterOptions } = useQuery({
    queryKey: ['cases', 'filters'],
    queryFn: () => api.get<FiltersResponse>('/cases/filters'),
  });

  const mutation = useMutation({
    mutationFn: (state: FormState) => {
      const body: Record<string, unknown> = {};
      if (state.applicationRoute) body.applicationRoute = state.applicationRoute;
      if (state.biometricsLocation) body.biometricsLocation = state.biometricsLocation;
      if (state.serviceTier) body.serviceTier = state.serviceTier;
      if (state.applicantNationalityCode)
        body.applicantNationalityCode = state.applicantNationalityCode;
      if (state.applicationDate) body.applicationDate = state.applicationDate;
      return api.post<EstimateResponse>('/estimate', body);
    },
  });

  // After we get results back on a narrow viewport (where the form sits ABOVE
  // the results stack), scroll the results into view so the user doesn't have
  // to hunt for them.
  useEffect(() => {
    if (mutation.data && resultsRef.current && window.innerWidth < 1024) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [mutation.data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);
    mutation.mutate(form);
  };

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------- */}
      {/* Header                                                  */}
      {/* ------------------------------------------------------- */}
      <header>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Personalised estimate
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          How long will your ILR take?
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Tell us about your application. We&rsquo;ll find applicants like you
          on public UK immigration forums and tell you, honestly, how long they
          waited — and how long you might still be waiting.
        </p>
      </header>

      {/* ------------------------------------------------------- */}
      {/* Two-column: form on the left, results on the right       */}
      {/* ------------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <FormCard
          form={form}
          onChange={handleChange}
          onSubmit={submit}
          onReset={() => {
            setForm(EMPTY_FORM);
            mutation.reset();
            setHasSubmitted(false);
          }}
          filterOptions={filterOptions}
          isLoading={mutation.isPending}
        />

        <div ref={resultsRef} className="min-w-0 scroll-mt-20">
          {mutation.isPending ? (
            <LoadingResults />
          ) : mutation.error ? (
            <ResultsError error={mutation.error} />
          ) : mutation.data ? (
            mutation.data.cohortSize === 0 ? (
              <NoMatchesState data={mutation.data} />
            ) : (
              <Results data={mutation.data} appliedAt={form.applicationDate} />
            )
          ) : (
            <EmptyState submitted={hasSubmitted} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// FORM
// ============================================

interface FormCardProps {
  form: FormState;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (e: React.FormEvent) => void;
  onReset: () => void;
  filterOptions: FiltersResponse | undefined;
  isLoading: boolean;
}

function FormCard({
  form,
  onChange,
  onSubmit,
  onReset,
  filterOptions,
  isLoading,
}: FormCardProps) {
  const hasAnyValue =
    !!form.applicationRoute ||
    !!form.biometricsLocation ||
    !!form.serviceTier ||
    !!form.applicantNationalityCode ||
    !!form.applicationDate;

  return (
    <Card className="self-start lg:sticky lg:top-20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Your application</CardTitle>
        <CardDescription>
          Every field is optional. The more you tell us, the tighter the
          comparison.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* Route */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Visa route
              <InfoTip term="route" />
            </Label>
            <Select
              value={form.applicationRoute || ALL_VALUE}
              onValueChange={(v) =>
                onChange('applicationRoute', v === ALL_VALUE ? '' : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any route" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Any route</SelectItem>
                {filterOptions?.applicationRoutes.map((route) => (
                  <SelectItem key={route} value={route}>
                    {route}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Service tier */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Service tier
              <InfoTip term="serviceTier" />
            </Label>
            <Select
              value={form.serviceTier || ALL_VALUE}
              onValueChange={(v) =>
                onChange(
                  'serviceTier',
                  v === ALL_VALUE ? '' : (v as ServiceTier),
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Any tier</SelectItem>
                {SERVICE_TIERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.serviceTier && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {SERVICE_TIERS.find((t) => t.value === form.serviceTier)?.help}
              </p>
            )}
          </div>

          {/* Biometrics location */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Fingerprint location
              <InfoTip term="biometrics" />
            </Label>
            <Select
              value={form.biometricsLocation || ALL_VALUE}
              onValueChange={(v) =>
                onChange('biometricsLocation', v === ALL_VALUE ? '' : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Any location</SelectItem>
                {filterOptions?.biometricsLocations.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Nationality */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Your nationality
              <InfoTip
                label="Nationality"
                text="Security and document checks vary by country, so this affects the typical wait more than people expect."
              />
            </Label>
            <Select
              value={form.applicantNationalityCode || ALL_VALUE}
              onValueChange={(v) =>
                onChange('applicantNationalityCode', v === ALL_VALUE ? '' : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any nationality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Any nationality</SelectItem>
                {sortedNationalityCodes(filterOptions?.nationalityCodes).map(
                  ({ code, label }) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Application date */}
          <div className="space-y-1.5">
            <Label
              htmlFor="applicationDate"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              Application date (optional)
              <InfoTip term="conditional" />
            </Label>
            <Input
              id="applicationDate"
              type="date"
              value={form.applicationDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => onChange('applicationDate', e.target.value)}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Add this and we&rsquo;ll also show &ldquo;you&rsquo;re at day X,
              here&rsquo;s how much longer&rdquo;.
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button type="submit" disabled={isLoading} className="w-full">
              <Calculator className="mr-1.5 h-4 w-4" />
              {isLoading ? 'Calculating…' : 'Get my estimate'}
            </Button>
            {hasAnyValue && !isLoading && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onReset}
                className="h-8 text-xs text-muted-foreground"
              >
                Reset all filters
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ============================================
// EMPTY / LOADING / ERROR STATES
// ============================================

function EmptyState({ submitted }: { submitted: boolean }) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Sparkles className="h-6 w-6" />
        </div>
        <p className="font-display text-lg font-semibold text-foreground">
          {submitted ? 'Adjust a filter and try again' : 'Ready when you are'}
        </p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Press <span className="font-medium text-foreground">Get my estimate</span>{' '}
          to compare yourself with thousands of recent ILR applicants. You can
          leave every field empty for a general view, or fill in what you know.
        </p>
      </CardContent>
    </Card>
  );
}

function LoadingResults() {
  // Skeleton mirrors the actual results layout so the page doesn't visibly
  // jump when data arrives: headline numbers, conditional panel, KM curve,
  // cohort summary, comparable cases.
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="mt-5 h-3 w-full" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-40" />
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-3 h-4 w-32" />
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-40" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-32 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-6">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-72" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NoMatchesState({ data }: { data: EstimateResponse }) {
  const f = data.filtersApplied;
  const activeFilters: string[] = [];
  if (f.applicationRoute) activeFilters.push(f.applicationRoute);
  if (f.serviceTier)
    activeFilters.push(
      SERVICE_TIERS.find((t) => t.value === f.serviceTier)?.label ?? f.serviceTier,
    );
  if (f.applicantNationalityCode)
    activeFilters.push(
      getCountryName(f.applicantNationalityCode) ?? f.applicantNationalityCode,
    );
  if (f.biometricsLocation) activeFilters.push(f.biometricsLocation);

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="h-6 w-6" />
        </div>
        <p className="font-display text-lg font-semibold text-foreground">
          No comparable cases yet
        </p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {activeFilters.length > 0 ? (
            <>
              We couldn&rsquo;t find anyone in the last {f.windowDays} days who
              matched{' '}
              <strong className="font-semibold text-foreground">
                {activeFilters.join(' + ')}
              </strong>
              . Try removing one filter — usually fingerprint location or
              service tier are the most restrictive.
            </>
          ) : (
            <>
              We don&rsquo;t have any decided cases in the last {f.windowDays}{' '}
              days yet. This is rare — check back after the next forum scrape.
            </>
          )}
        </p>
        {data.cohortRelaxation.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            We already tried relaxing{' '}
            {data.cohortRelaxation.map((s) => prettifyField(s.droppedFilter)).join(', ')}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ResultsError({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : 'Something went wrong fetching your estimate. Try again in a moment.';
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="space-y-1 p-5">
        <p className="text-sm font-semibold text-destructive">
          We couldn&rsquo;t calculate that estimate.
        </p>
        <p className="text-xs text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

// ============================================
// RESULTS
// ============================================

function Results({
  data,
  appliedAt,
}: {
  data: EstimateResponse;
  appliedAt: string;
}) {
  const isFree = data.tier === 'free';

  // The API already redacts premium fields for free users (percentiles
  // beyond median, approval rate, kmCurve, conditional, 6th+ comparables).
  // The frontend just decides what to render in their place: clean
  // "unlock" cards rather than blurred ghosts.
  return (
    <div className="space-y-6">
      {isFree && <FreePreviewBanner cohortSize={data.cohortSize} />}

      {/* Top-line numbers — different shape for free vs paid */}
      {isFree ? (
        <FreeHeadline data={data} />
      ) : (
        <HeadlineNumbers data={data} />
      )}

      {/* "Where am I now" panel — paid only */}
      {!isFree && data.conditional && (
        <ConditionalPanel
          conditional={data.conditional}
          applicationDate={appliedAt}
        />
      )}
      {isFree && appliedAt && <LockedConditionalCard />}

      {/* Survival curve — paid only; free sees a locked card */}
      {isFree ? <LockedChartCard /> : <SurvivalChart data={data} />}

      {/* Cohort makeup + relaxation chain — visible to everyone (it's part of the honesty pitch) */}
      <CohortSummary data={data} />

      {/* Comparable cases — table renders whatever the API sent (5 or 20).
          Empty array means the API suppressed it (k-anonymity); the
          disclaimer block will explain that, so we don't double-message. */}
      <ComparableCasesTable data={data} />
      {isFree &&
        data.comparableCases.length > 0 &&
        data.cohortSize > data.comparableCases.length && (
          <UnlockMoreCasesCard
            shown={data.comparableCases.length}
            total={data.cohortSize}
          />
        )}

      {/* Honest disclaimers */}
      <Disclaimers items={data.disclaimers} />
    </div>
  );
}

// ============================================
// FREE-TIER COMPONENTS
// ============================================

/** Top-of-results banner that explains the free preview and offers upgrade. */
function FreePreviewBanner({ cohortSize }: { cohortSize: number }) {
  return (
    <Card className="border-primary/30 bg-linear-to-br from-primary/5 to-chart-2/5">
      <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Free preview
          </p>
          <p className="mt-1 text-sm leading-snug text-foreground">
            You&rsquo;re seeing the typical wait and 5 comparable cases from{' '}
            <strong className="font-semibold">{cohortSize.toLocaleString()}</strong>{' '}
            applicants like you.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Unlock the fast/slow range, approval rate, full wait-time curve,
            and 15 more cases for £29 — kept active until your decision.
          </p>
        </div>
        <UpgradeButton size="default" />
      </CardContent>
    </Card>
  );
}

/**
 * Single-card median display for free users. Replaces the 3-card grid that
 * paid users see; visually distinct rather than just half-empty.
 */
function FreeHeadline({ data }: { data: EstimateResponse }) {
  const median = data.percentiles.median;
  const { cohortSize, decidedCount, pendingCount } = data;
  const cohortTooSmall = cohortSize < 30;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Hourglass className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Typical wait
              <InfoTip term="median" />
            </p>
            <p className="mt-1 font-display text-4xl font-bold text-foreground">
              {median !== null ? `${median} days` : '—'}
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {median !== null
                ? `\u2248 ${monthsFromDays(median)} months from application — the median across comparable applicants.`
                : 'Not enough decided cases to estimate.'}
            </p>
          </div>
        </div>
        <p
          className={cn(
            'mt-5 border-t pt-4 text-xs',
            cohortTooSmall ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
          )}
        >
          Based on{' '}
          <strong className="font-semibold text-foreground">
            {cohortSize.toLocaleString()}
          </strong>{' '}
          comparable applicants ({decidedCount.toLocaleString()} decided,{' '}
          {pendingCount.toLocaleString()} still waiting)
          {cohortTooSmall && ' — small cohort, treat as directional only.'}
        </p>
      </CardContent>
    </Card>
  );
}

function LockedConditionalCard() {
  return (
    <LockedFeatureCard
      icon={Calendar}
      title="Where you are right now"
      description="See what % of comparable applicants had decided by your current day, and how much longer you might still wait."
    />
  );
}

function LockedChartCard() {
  return (
    <LockedFeatureCard
      icon={TrendingDown}
      title="The full wait-time curve"
      description="Decision-by-day curve across your cohort with median + percentile reference lines. Tells you how the wait actually distributes — not just one number."
    />
  );
}

function UnlockMoreCasesCard({
  shown,
  total,
}: {
  shown: number;
  total: number;
}) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Showing {shown} of up to {Math.min(total, 20).toLocaleString()} comparable cases
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            See the full sample — recent applicants with route, tier, wait,
            and source link for each.
          </p>
        </div>
        <UpgradeButton size="sm" />
      </CardContent>
    </Card>
  );
}

function LockedFeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-display text-base font-semibold text-foreground">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            {title}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
        <UpgradeButton size="sm" />
      </CardContent>
    </Card>
  );
}

function UpgradeButton({ size = 'default' }: { size?: 'sm' | 'default' }) {
  return (
    <Button
      type="button"
      size={size}
      className="shrink-0"
      onClick={() => {
        // TODO: wire to Stripe Checkout once /billing endpoint exists.
        window.alert(
          'Checkout is coming very soon. Until then, please contact us if you want early access.',
        );
      }}
    >
      {'Unlock for \u00A329'}
    </Button>
  );
}

function HeadlineNumbers({ data }: { data: EstimateResponse }) {
  const { percentiles, approvalRate, cohortSize, decidedCount, pendingCount } = data;
  const cohortTooSmall = cohortSize < 30;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <Metric
            icon={Hourglass}
            label={
              <>
                Typical wait
                <InfoTip term="median" />
              </>
            }
            value={percentiles.median !== null ? `${percentiles.median} days` : '—'}
            sub={
              percentiles.median !== null
                ? `\u2248 ${monthsFromDays(percentiles.median)} months from application`
                : 'Too few cases to estimate.'
            }
          />
          <Metric
            icon={TrendingDown}
            label={
              <>
                Fast / slow ends
                <InfoTip term="percentiles" />
              </>
            }
            value={
              percentiles.p25 !== null && percentiles.p75 !== null
                ? `${percentiles.p25} \u2013 ${percentiles.p75}`
                : '—'
            }
            sub={
              percentiles.p25 !== null && percentiles.p75 !== null
                ? `Middle half waited between P25 and P75 days`
                : 'Need more decided cases.'
            }
          />
          <Metric
            icon={ShieldAlert}
            label={
              <>
                Approval rate
                <InfoTip term="approvalRate" />
              </>
            }
            value={approvalRate !== null ? `${Math.round(approvalRate * 100)}%` : '—'}
            sub={
              approvalRate !== null
                ? `Among ${decidedCount.toLocaleString()} decided cases — forum-biased.`
                : 'Hidden when too few decided cases (\u2265 10 needed).'
            }
          />
        </div>
        <p
          className={cn(
            'mt-5 border-t pt-4 text-xs',
            cohortTooSmall ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
          )}
        >
          Based on{' '}
          <strong className="font-semibold text-foreground">
            {cohortSize.toLocaleString()}
          </strong>{' '}
          comparable applicants ({decidedCount.toLocaleString()} decided,{' '}
          {pendingCount.toLocaleString()} still waiting)
          {cohortTooSmall && ' — small cohort, treat the numbers as directional only.'}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 truncate font-display text-2xl font-bold text-foreground">
          {value}
        </p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function ConditionalPanel({
  conditional,
  applicationDate,
}: {
  conditional: NonNullable<EstimateResponse['conditional']>;
  applicationDate: string;
}) {
  const decidedByNowPct = Math.round(conditional.decidedByNowFraction * 100);
  const remaining = conditional.conditionalMedianRemaining;
  const applied = applicationDate ? new Date(applicationDate) : null;
  const projectedDecision =
    applied && remaining !== null
      ? new Date(applied.getTime() + (conditional.currentDay + remaining) * DAY_MS)
      : null;

  return (
    <Card className="border-primary/25 bg-linear-to-br from-primary/5 to-chart-2/5">
      <CardContent className="p-6">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Where you are now
          <InfoTip term="conditional" className="text-primary/70" />
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
          Day {conditional.currentDay} of your wait
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Decided by now
            </p>
            <p className="mt-1 font-display text-3xl font-bold text-foreground">
              {decidedByNowPct}%
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              of comparable applicants had a decision by day {conditional.currentDay}.
              You&rsquo;re in the {100 - decidedByNowPct}% still waiting.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Likely remaining wait
            </p>
            <p className="mt-1 font-display text-3xl font-bold text-foreground">
              {remaining !== null ? `${remaining} days` : '—'}
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {remaining !== null && projectedDecision
                ? `Half of people in your position got a decision in another ${remaining} days — roughly ${formatDate(projectedDecision)}.`
                : 'Too few comparable cases past your day to estimate.'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SurvivalChart({ data }: { data: EstimateResponse }) {
  // Render decided-by-day: 1 - S(t). Users find "% who got a decision by day N"
  // much easier than the survival function itself.
  const chartData = useMemo(
    () =>
      data.kmCurve.map((p) => ({
        day: p.day,
        decidedPct: Math.round((1 - p.survival) * 100),
        atRisk: p.atRisk,
      })),
    [data.kmCurve],
  );

  const median = data.percentiles.median;
  const conditionalDay = data.conditional?.currentDay ?? null;

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            Wait-time curve
            <InfoTip term="survivalCurve" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Not enough data to draw a curve.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Wait-time curve
          <InfoTip term="survivalCurve" />
        </CardTitle>
        <CardDescription>
          Share of comparable applicants who had a decision by each day
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer>
            <AreaChart
              data={chartData}
              margin={{ top: 8, right: 20, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="estimateFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(d: number) => `${d}d`}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={36}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <RechartsTooltip
                cursor={{ stroke: 'var(--color-foreground)', strokeOpacity: 0.1 }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload as
                    | { day: number; decidedPct: number; atRisk: number }
                    | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border bg-popover p-2.5 text-xs shadow-md">
                      <p className="font-medium text-foreground">Day {p.day}</p>
                      <p className="text-muted-foreground">
                        {p.decidedPct}% decided by now
                      </p>
                      <p className="text-muted-foreground">
                        {p.atRisk} still waiting in cohort
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="stepAfter"
                dataKey="decidedPct"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#estimateFill)"
              />
              {median !== null && (
                <ReferenceLine
                  x={median}
                  stroke="var(--color-foreground)"
                  strokeOpacity={0.35}
                  strokeDasharray="4 4"
                  label={{
                    value: `Median ${median}d`,
                    position: 'insideTopRight',
                    fill: 'var(--color-foreground)',
                    fontSize: 11,
                    opacity: 0.7,
                  }}
                />
              )}
              {conditionalDay !== null && (
                <ReferenceLine
                  x={conditionalDay}
                  stroke="var(--color-chart-2)"
                  strokeWidth={2}
                  label={{
                    value: `You: day ${conditionalDay}`,
                    position: 'insideTopLeft',
                    fill: 'var(--color-chart-2)',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          The dashed line is the median: 50% had decisions by that day.
          {conditionalDay !== null && ' The solid coloured line is your current day.'}
        </p>
      </CardContent>
    </Card>
  );
}

function CohortSummary({ data }: { data: EstimateResponse }) {
  const f = data.filtersApplied;
  const hasFilters =
    f.applicationRoute ||
    f.serviceTier ||
    f.applicantNationalityCode ||
    f.biometricsLocation;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Who&rsquo;s in your cohort
          <InfoTip term="cohort" />
        </CardTitle>
        <CardDescription>
          The exact filter set we ended up using and any compromises we had to
          make to find enough cases.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters applied */}
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters ? (
            <>
              {f.applicationRoute && (
                <Pill label="Route" value={f.applicationRoute} />
              )}
              {f.serviceTier && (
                <Pill
                  label="Tier"
                  value={
                    SERVICE_TIERS.find((t) => t.value === f.serviceTier)?.label ??
                    f.serviceTier
                  }
                />
              )}
              {f.applicantNationalityCode && (
                <Pill
                  label="Nationality"
                  value={
                    getCountryName(f.applicantNationalityCode) ??
                    f.applicantNationalityCode
                  }
                />
              )}
              {f.biometricsLocation && (
                <Pill label="Location" value={f.biometricsLocation} />
              )}
              <span className="text-[11px] text-muted-foreground">
                · last {f.windowDays} days
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              No filters applied — comparing against the whole {f.windowDays}-day window.
            </span>
          )}
        </div>

        {/* Relaxation chain */}
        {data.cohortRelaxation.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              We widened the search to find enough cases
            </p>
            <ol className="mt-2 space-y-1.5 text-amber-800 dark:text-amber-200/80">
              {data.cohortRelaxation.map((step, i) => (
                <li key={i} className="flex items-center gap-2">
                  <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Dropped{' '}
                    <strong className="font-semibold">{prettifyField(step.droppedFilter)}</strong>:{' '}
                    {step.cohortBefore} {'\u2192'} {step.cohortAfter} cases
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-[11px]">
      <span className="font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
}

function ComparableCasesTable({ data }: { data: EstimateResponse }) {
  const rows = data.comparableCases;
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Comparable cases</CardTitle>
        <CardDescription>
          A sample of recent applicants who match your filters. Source links go
          back to the original forum post — no usernames.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Route</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Nat.</th>
                <th className="px-3 py-2 text-left">Applied</th>
                <th className="px-3 py-2 text-left">Decision</th>
                <th className="px-3 py-2 text-right">Wait</th>
                <th className="px-3 py-2 text-left">Outcome</th>
                <th className="px-3 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t transition-colors hover:bg-muted/40">
                  <td className="px-3 py-3 font-medium text-foreground">
                    {row.applicationRoute ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.serviceTier
                      ? (SERVICE_TIERS.find((t) => t.value === row.serviceTier)?.label ??
                        row.serviceTier)
                      : '—'}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.applicantNationalityCode ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(row.applicationDate)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(row.decisionDate)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground">
                    {formatDays(row.waitingDays)}
                  </td>
                  <td className="px-3 py-3">
                    <OutcomeBadge outcome={row.outcome} isPending={row.isPending} />
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80 hover:underline"
                    >
                      Forum
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomeBadge({
  outcome,
  isPending,
}: {
  outcome: string | null;
  isPending: boolean;
}) {
  const effective = isPending ? 'pending' : (outcome ?? 'unknown');
  const map: Record<string, { label: string; cls: string }> = {
    approved: {
      label: 'Approved',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    rejected: {
      label: 'Refused',
      cls: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
    },
    pending: {
      label: 'Still waiting',
      cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    },
    unknown: {
      label: 'Unknown',
      cls: 'border-border bg-muted text-muted-foreground',
    },
  };

  const entry = map[effective] ?? map.unknown!;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        entry.cls,
      )}
    >
      {entry.label}
    </span>
  );
}

function Disclaimers({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="bg-muted/30">
      <CardContent className="p-5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          Caveats we won&rsquo;t hide
        </p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          {items.map((text, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ============================================
// HELPERS
// ============================================

function monthsFromDays(days: number): string {
  const months = days / 30.4;
  return (Math.round(months * 10) / 10).toString();
}

function prettifyField(field: string): string {
  return (
    {
      biometricsLocation: 'fingerprint location',
      serviceTier: 'service tier',
      applicantNationalityCode: 'nationality',
      applicationRoute: 'visa route',
    } as Record<string, string>
  )[field] ?? field;
}

/**
 * Turn the API's bare ISO-2 codes ("PK", "IN", ...) into "Pakistan", "India",
 * ... and sort alphabetically by display name. Unknown codes fall through
 * with the raw code as the label so we never lose data.
 */
function sortedNationalityCodes(
  codes: string[] | undefined,
): Array<{ code: string; label: string }> {
  if (!codes || codes.length === 0) return [];
  return codes
    .map((code) => {
      const name = getCountryName(code);
      return { code, label: name ? `${name} (${code})` : code };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
