import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDate, formatDays } from '@/lib/utils';
import type { CaseWithSource, PaginatedResponse } from '@ilr/shared';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

interface FiltersResponse {
  applicationRoutes: string[];
  applicationTypes: string[];
  serviceCenters: string[];
  sources: { id: string; name: string; displayName: string }[];
}

export function Cases() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    applicationRoute: '',
    outcome: '',
    serviceCenter: '',
  });

  // Fetch filter options
  const { data: filterOptions } = useQuery({
    queryKey: ['cases', 'filters'],
    queryFn: () => api.get<FiltersResponse>('/cases/filters'),
  });

  // Build query params
  const queryParams = new URLSearchParams();
  queryParams.set('page', page.toString());
  queryParams.set('limit', '20');
  if (filters.applicationRoute) queryParams.set('applicationRoute', filters.applicationRoute);
  if (filters.outcome) queryParams.set('outcome', filters.outcome);
  if (filters.serviceCenter) queryParams.set('serviceCenter', filters.serviceCenter);

  // Fetch cases
  const { data, isLoading, error } = useQuery({
    queryKey: ['cases', page, filters],
    queryFn: () => api.get<PaginatedResponse<CaseWithSource>>(`/cases?${queryParams.toString()}`),
  });

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page when filters change
  };

  const clearFilters = () => {
    setFilters({ applicationRoute: '', outcome: '', serviceCenter: '' });
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cases</h1>
        <p className="text-muted-foreground">
          Browse extracted ILR case data from community forums
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Select
              value={filters.applicationRoute}
              onValueChange={(v) => handleFilterChange('applicationRoute', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Route" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All routes</SelectItem>
                {filterOptions?.applicationRoutes.map((route) => (
                  <SelectItem key={route} value={route}>
                    {route}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.outcome}
              onValueChange={(v) => handleFilterChange('outcome', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All outcomes</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.serviceCenter}
              onValueChange={(v) => handleFilterChange('serviceCenter', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Service Center" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All centers</SelectItem>
                {filterOptions?.serviceCenters.map((center) => (
                  <SelectItem key={center} value={center}>
                    {center}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cases table */}
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>
            {data?.pagination.total ?? 0} cases found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive">Failed to load cases</p>
            </div>
          ) : data?.data.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No cases found matching your criteria
            </div>
          ) : (
            <>
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs uppercase bg-muted">
                    <tr>
                      <th className="px-4 py-3">Route</th>
                      <th className="px-4 py-3">Application</th>
                      <th className="px-4 py-3">Decision</th>
                      <th className="px-4 py-3">Wait</th>
                      <th className="px-4 py-3">Outcome</th>
                      <th className="px-4 py-3">Center</th>
                      <th className="px-4 py-3">Confidence</th>
                      <th className="px-4 py-3">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.data.map((caseItem) => (
                      <tr key={caseItem.id} className="border-b hover:bg-muted/50">
                        <td className="px-4 py-3 font-medium">
                          {caseItem.applicationRoute || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {formatDate(caseItem.applicationDate)}
                        </td>
                        <td className="px-4 py-3">
                          {formatDate(caseItem.decisionDate)}
                        </td>
                        <td className="px-4 py-3">
                          {formatDays(caseItem.waitingDays)}
                        </td>
                        <td className="px-4 py-3">
                          <OutcomeBadge outcome={caseItem.outcome} />
                        </td>
                        <td className="px-4 py-3">
                          {caseItem.serviceCenter || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <ConfidenceBadge confidence={caseItem.confidence} />
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={caseItem.post.thread.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-primary hover:underline"
                          >
                            {caseItem.post.thread.source.displayName}
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data?.pagination && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
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

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-muted-foreground">-</span>;

  const colors: Record<string, string> = {
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
    unknown: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[outcome] || colors['unknown']}`}>
      {outcome}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  let color = 'text-red-600';
  if (percent >= 70) color = 'text-green-600';
  else if (percent >= 50) color = 'text-yellow-600';

  return <span className={`font-medium ${color}`}>{percent}%</span>;
}
