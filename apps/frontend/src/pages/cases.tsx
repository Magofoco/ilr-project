import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTip } from '@/components/ui/info-tip';
import { api } from '@/lib/api';
import { cn, formatDate, formatDays } from '@/lib/utils';
import type { CaseWithSource, PaginatedResponse } from '@ilr/shared';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';

interface FiltersResponse {
  applicationRoutes: string[];
  applicationTypes: string[];
  biometricsLocations: string[];
  serviceTiers: string[];
  nationalityCodes: string[];
  sources: { id: string; name: string; displayName: string }[];
}

const ALL_VALUE = '__all__';

export function Cases() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    applicationRoute: '',
    outcome: '',
    biometricsLocation: '',
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['cases', 'filters'],
    queryFn: () => api.get<FiltersResponse>('/cases/filters'),
  });

  const queryParams = new URLSearchParams();
  queryParams.set('page', page.toString());
  queryParams.set('limit', '20');
  if (filters.applicationRoute)
    queryParams.set('applicationRoute', filters.applicationRoute);
  if (filters.outcome) queryParams.set('outcome', filters.outcome);
  if (filters.biometricsLocation)
    queryParams.set('biometricsLocation', filters.biometricsLocation);

  const { data, isLoading, error } = useQuery({
    queryKey: ['cases', page, filters],
    queryFn: () =>
      api.get<PaginatedResponse<CaseWithSource>>(`/cases?${queryParams.toString()}`),
  });

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value === ALL_VALUE ? '' : value,
    }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({ applicationRoute: '', outcome: '', biometricsLocation: '' });
    setPage(1);
  };

  const activeCount =
    Number(!!filters.applicationRoute) +
    Number(!!filters.outcome) +
    Number(!!filters.biometricsLocation);

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Real applicant timelines
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Browse cases
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each row is one anonymised forum post. We never store usernames, but
          we keep a link to the original so you can read it in context.
        </p>
      </div>

      {/* Status legend — helps newcomers understand the badges before they hit them */}
      <Card className="bg-muted/30">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Status guide:</span>
          <LegendItem swatch="emerald" label="Approved" hint="ILR granted" />
          <LegendItem swatch="rose" label="Refused" hint="ILR refused (can be appealed)" />
          <LegendItem
            swatch="amber"
            label="Still waiting"
            hint="No decision reported yet"
          />
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Filter the list</CardTitle>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={clearFilters}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear ({activeCount})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Visa route
                <InfoTip term="route" />
              </Label>
              <Select
                value={filters.applicationRoute || ALL_VALUE}
                onValueChange={(v) => handleFilterChange('applicationRoute', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All routes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All routes</SelectItem>
                  {filterOptions?.applicationRoutes.map((route) => (
                    <SelectItem key={route} value={route}>
                      {route}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Outcome
                <InfoTip term="outcome" />
              </Label>
              <Select
                value={filters.outcome || ALL_VALUE}
                onValueChange={(v) => handleFilterChange('outcome', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All outcomes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All outcomes</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Refused</SelectItem>
                  <SelectItem value="pending">Still waiting</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Fingerprint location
                <InfoTip term="biometrics" />
              </Label>
              <Select
                value={filters.biometricsLocation || ALL_VALUE}
                onValueChange={(v) =>
                  handleFilterChange('biometricsLocation', v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All locations</SelectItem>
                  {filterOptions?.biometricsLocations.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cases table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Results</CardTitle>
          <CardDescription>
            {(data?.pagination.total ?? 0).toLocaleString()} cases found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton />
          ) : error ? (
            <div className="py-16 text-center text-sm text-destructive">
              We couldn&rsquo;t load the cases right now. Try refreshing.
            </div>
          ) : data?.data.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No cases match those filters. Try removing one.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-1.5">
                          Route
                          <InfoTip term="route" />
                        </span>
                      </th>
                      <th className="px-3 py-2 text-left">Applied</th>
                      <th className="px-3 py-2 text-left">Decision</th>
                      <th className="px-3 py-2 text-right">Wait</th>
                      <th className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-1.5">
                          Outcome
                          <InfoTip term="outcome" />
                        </span>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-1.5">
                          Fingerprints
                          <InfoTip term="biometrics" />
                        </span>
                      </th>
                      <th className="px-3 py-2 text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          Confidence
                          <InfoTip term="confidence" />
                        </span>
                      </th>
                      <th className="px-3 py-2 text-left">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.data.map((caseItem) => (
                      <tr
                        key={caseItem.id}
                        className="border-t transition-colors hover:bg-muted/40"
                      >
                        <td className="px-3 py-3 font-medium text-foreground">
                          {caseItem.applicationRoute || '—'}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDate(caseItem.applicationDate)}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDate(caseItem.decisionDate)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">
                          {formatDays(caseItem.waitingDays)}
                        </td>
                        <td className="px-3 py-3">
                          <OutcomeBadge outcome={caseItem.outcome} />
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {caseItem.biometricsLocation || '—'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <ConfidenceBadge confidence={caseItem.confidence} />
                        </td>
                        <td className="px-3 py-3">
                          <a
                            href={caseItem.post.thread.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary/80 hover:underline"
                          >
                            {caseItem.post.thread.source.displayName}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data?.pagination && data.pagination.totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    Page {data.pagination.page} of {data.pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= data.pagination.totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LegendItem({
  swatch,
  label,
  hint,
}: {
  swatch: 'emerald' | 'rose' | 'amber';
  label: string;
  hint: string;
}) {
  const dot = {
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
  }[swatch];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', dot)} />
      <span className="font-medium text-foreground">{label}</span>
      <span className="hidden text-muted-foreground sm:inline">— {hint}</span>
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-muted-foreground">—</span>;

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

  const entry = map[outcome] ?? map.unknown!;

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

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  const cls =
    percent >= 70
      ? 'text-emerald-700 dark:text-emerald-300'
      : percent >= 50
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-rose-700 dark:text-rose-300';

  return (
    <span className={cn('font-medium tabular-nums', cls)}>{percent}%</span>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-full" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
