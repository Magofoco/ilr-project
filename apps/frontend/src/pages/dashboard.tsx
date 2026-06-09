import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTip } from '@/components/ui/info-tip';
import { api } from '@/lib/api';
import type { OverviewStats } from '@ilr/shared';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { BarChart3, Clock, Database, ShieldCheck, Sparkles } from 'lucide-react';

const SERVICE_STANDARD_DAYS = 182; // UKVI public target: ~6 months

const barChartConfig = {
  medianDays: { label: 'Typical days', color: 'var(--color-primary)' },
};

const monthChartConfig = {
  count: { label: 'Cases', color: 'var(--color-chart-2)' },
};

export function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => api.get<OverviewStats>('/stats/overview'),
  });

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Free preview &middot; Updated daily
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          How long does UK ILR really take?
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          What you&rsquo;re looking at: the typical waiting time that real
          applicants reported on public UK immigration forums, refreshed every
          day. No usernames, no personal data — only the timelines.
        </p>
      </div>

      {/* What is ILR? — prominent, friendly explainer for first-time visitors */}
      <Card className="border-primary/15 bg-accent/40">
        <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:gap-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">
              New here? In one sentence:
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong className="font-semibold text-foreground">ILR</strong>{' '}
              (Indefinite Leave to Remain) is UK permanent residency. You apply
              online, give fingerprints at a UKVCAS centre, and then wait for
              the Home Office to decide. This page shows how long that wait
              actually takes for people like you.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      {isLoading ? (
        <StatCardsSkeleton />
      ) : error ? (
        <ErrorBanner />
      ) : (
        <StatCards stats={stats} />
      )}

      {/* Charts */}
      {!error && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base">
                Typical wait by route
                <InfoTip term="route" />
              </CardTitle>
              <CardDescription>
                Median days from application to decision, by visa route
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : stats?.byRoute && stats.byRoute.length > 0 ? (
                <ChartContainer config={barChartConfig} className="h-[280px] w-full">
                  <BarChart
                    data={stats.byRoute}
                    margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="route"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="medianDays"
                      fill="var(--color-medianDays)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cases by month</CardTitle>
              <CardDescription>
                How many decisions were reported in each of the last 12 months
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : stats?.byMonth && stats.byMonth.length > 0 ? (
                <ChartContainer config={monthChartConfig} className="h-[280px] w-full">
                  <BarChart
                    data={stats.byMonth}
                    margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatMonthTick}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="count"
                      fill="var(--color-count)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Target vs reality — strong differentiator */}
      {!isLoading && !error && stats?.medianWaitingDays !== null && stats?.medianWaitingDays !== undefined && (
        <TargetVsReality medianDays={stats.medianWaitingDays} />
      )}

      {/* Route breakdown */}
      {!isLoading && !error && stats?.byRoute && stats.byRoute.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              By visa route
              <InfoTip term="route" />
            </CardTitle>
            <CardDescription>
              Click a route name in your account to filter to people like you
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-4 text-left">Route</th>
                    <th className="py-2 px-4 text-right">Cases</th>
                    <th className="py-2 pl-4 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        Typical days
                        <InfoTip term="median" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byRoute.map((row) => (
                    <tr key={row.route} className="border-t">
                      <td className="py-3 pr-4 font-medium text-foreground">
                        {row.route}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                        {row.count.toLocaleString()}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums font-medium text-foreground">
                        {row.medianDays !== null
                          ? `${row.medianDays} days`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        ILR Tracker reports waiting-time statistics from public forums. Numbers
        are a self-selected sample and are <strong>not immigration advice</strong>.
        For a personalised estimate filtered to your nationality, route and
        location — and a list of comparable cases — sign in.
      </p>
    </div>
  );
}

function StatCards({ stats }: { stats: OverviewStats | undefined }) {
  const totalCases = stats?.totalCases ?? 0;
  const lastMonth = stats?.casesLast30Days ?? 0;
  const median = stats?.medianWaitingDays ?? null;
  const decided = stats?.decidedCount ?? 0;
  const pending = stats?.pendingCount ?? 0;
  const decidedMean = stats?.averageWaitingDaysDecided ?? null;
  const approval = stats?.approvalRate ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Database}
        label={'Cases we\u2019ve seen'}
        value={totalCases.toLocaleString()}
        sub={`+${lastMonth.toLocaleString()} in the last 30 days`}
      />
      <StatCard
        icon={Clock}
        label="Typical wait today"
        value={median !== null ? `${median} days` : '—'}
        sub="Half waited less, half waited more"
        infoTerm="median"
      />
      <StatCard
        icon={BarChart3}
        label="Decided / still waiting"
        value={`${decided.toLocaleString()} / ${pending.toLocaleString()}`}
        sub={
          decidedMean !== null
            ? `Average of decided cases: ${decidedMean} days`
            : 'Average unavailable'
        }
        infoTerm="pending"
      />
      <StatCard
        icon={ShieldCheck}
        label="Approved (of decided)"
        value={approval !== null ? `${approval}%` : '—'}
        sub="Self-reported on forums — probably optimistic"
        infoTerm="approvalRate"
      />
    </div>
  );
}

function StatCardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-start gap-4 p-5">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ErrorBanner() {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="p-5">
        <p className="text-sm font-medium text-destructive">
          We couldn&rsquo;t load the live numbers right now.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try refreshing the page in a moment. If it keeps happening, the API
          might be down.
        </p>
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  infoTerm,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  infoTerm?: Parameters<typeof InfoTip>[0]['term'];
}) {
  return (
    <Card className="transition-shadow hover:shadow-md hover:shadow-foreground/5">
      <CardContent className="flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Icon className="h-5 w-5 text-accent-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span>{label}</span>
            {infoTerm && <InfoTip term={infoTerm} />}
          </p>
          <p className="mt-1 truncate font-display text-2xl font-bold leading-tight text-foreground">
            {value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TargetVsReality({ medianDays }: { medianDays: number }) {
  const overBy = medianDays - SERVICE_STANDARD_DAYS;
  const isOver = overBy > 0;
  const targetMonths = Math.round((SERVICE_STANDARD_DAYS / 30.4) * 10) / 10;
  const realMonths = Math.round((medianDays / 30.4) * 10) / 10;

  return (
    <Card className="border-primary/20 bg-linear-to-br from-primary/4 to-chart-2/4">
      <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_1px_1fr] md:gap-8">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Home Office target
            <InfoTip term="serviceStandard" />
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-foreground">
            ~{targetMonths} months
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The Home Office&rsquo;s published service standard for most ILR
            routes
          </p>
        </div>
        <div className="hidden bg-border md:block" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            What people actually wait
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-foreground">
            ~{realMonths} months
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isOver
              ? `That\u2019s ${overBy} days longer than the target — about ${Math.round(
                  (overBy / SERVICE_STANDARD_DAYS) * 100,
                )}% over.`
              : 'In line with the published target right now.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
      No data available yet
    </div>
  );
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatMonthTick(value: string): string {
  const month = value.split('-')[1];
  if (!month) return value;
  return MONTH_NAMES[parseInt(month, 10) - 1] ?? value;
}
