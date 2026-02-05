import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Plus, Play, RefreshCw } from 'lucide-react';

interface SourceWithCounts {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  _count: { threads: number; scrapeRuns: number };
}

interface ScrapeRunWithSource {
  id: string;
  sourceId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  threadsFound: number;
  postsScraped: number;
  casesExtracted: number;
  errorMessage: string | null;
  source: { id: string; name: string; displayName: string };
}

export function Admin() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSource, setNewSource] = useState({
    name: '',
    displayName: '',
    baseUrl: '',
    type: 'playwright',
  });

  // Fetch sources
  const { data: sources, isLoading: loadingSources } = useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: () => api.get<SourceWithCounts[]>('/admin/sources', { authenticated: true }),
  });

  // Fetch recent scrape runs
  const { data: scrapeRuns, isLoading: loadingRuns } = useQuery({
    queryKey: ['admin', 'scrapeRuns'],
    queryFn: () => api.get<ScrapeRunWithSource[]>('/admin/scrape/runs', { authenticated: true }),
  });

  // Create source mutation
  const createSource = useMutation({
    mutationFn: (data: typeof newSource) =>
      api.post('/admin/sources', data, { authenticated: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
      setShowAddForm(false);
      setNewSource({ name: '', displayName: '', baseUrl: '', type: 'playwright' });
    },
  });

  // Trigger scrape mutation
  const triggerScrape = useMutation({
    mutationFn: (sourceId: string) =>
      api.post('/admin/scrape/trigger', { sourceId }, { authenticated: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'scrapeRuns'] });
    },
  });

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault();
    createSource.mutate(newSource);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1>
        <p className="text-muted-foreground">Manage data sources and scrape runs</p>
      </div>

      {/* Sources */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Data Sources</CardTitle>
            <CardDescription>Configured forum sources for scraping</CardDescription>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Source
          </Button>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <form onSubmit={handleAddSource} className="mb-6 p-4 border rounded-lg space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name (slug)</Label>
                  <Input
                    id="name"
                    placeholder="immigrationboards"
                    value={newSource.name}
                    onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    placeholder="Immigration Boards UK"
                    value={newSource.displayName}
                    onChange={(e) => setNewSource((s) => ({ ...s, displayName: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baseUrl">Base URL</Label>
                  <Input
                    id="baseUrl"
                    placeholder="https://www.immigrationboards.com"
                    value={newSource.baseUrl}
                    onChange={(e) => setNewSource((s) => ({ ...s, baseUrl: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Scraper Type</Label>
                  <Select
                    value={newSource.type}
                    onValueChange={(v) => setNewSource((s) => ({ ...s, type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="playwright">Playwright (JS-heavy)</SelectItem>
                      <SelectItem value="fetch">Fetch + Cheerio (static)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createSource.isPending}>
                  {createSource.isPending ? 'Creating...' : 'Create Source'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {loadingSources ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : sources?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No sources configured yet
            </p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">URL</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Threads</th>
                    <th className="px-4 py-3 text-right">Runs</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sources?.map((source) => (
                    <tr key={source.id} className="border-b">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{source.displayName}</p>
                          <p className="text-xs text-muted-foreground">{source.name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{source.baseUrl}</td>
                      <td className="px-4 py-3">{source.type}</td>
                      <td className="px-4 py-3 text-right">{source._count.threads}</td>
                      <td className="px-4 py-3 text-right">{source._count.scrapeRuns}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            source.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {source.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => triggerScrape.mutate(source.id)}
                          disabled={triggerScrape.isPending}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Scrape
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Scrape Runs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Scrape Runs</CardTitle>
            <CardDescription>History of scraping jobs</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'scrapeRuns'] })}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loadingRuns ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : scrapeRuns?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No scrape runs yet</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted">
                  <tr>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3 text-right">Threads</th>
                    <th className="px-4 py-3 text-right">Posts</th>
                    <th className="px-4 py-3 text-right">Cases</th>
                    <th className="px-4 py-3">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {scrapeRuns?.map((run) => (
                    <tr key={run.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{run.source.displayName}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-3">{formatDate(run.startedAt)}</td>
                      <td className="px-4 py-3 text-right">{run.threadsFound}</td>
                      <td className="px-4 py-3 text-right">{run.postsScraped}</td>
                      <td className="px-4 py-3 text-right">{run.casesExtracted}</td>
                      <td className="px-4 py-3 text-destructive text-xs">
                        {run.errorMessage?.slice(0, 50)}
                        {run.errorMessage && run.errorMessage.length > 50 ? '...' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}
