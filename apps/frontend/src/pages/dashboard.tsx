import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { OverviewStats } from '@ilr/shared';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => api.get<OverviewStats>('/stats/overview'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Failed to load statistics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ILR Waiting Times Dashboard</h1>
        <p className="text-muted-foreground">
          Community-sourced data on UK Indefinite Leave to Remain processing times
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalCases ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              +{stats?.casesLast30Days ?? 0} in last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Median Wait Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.medianWaitingDays ? `${stats.medianWaitingDays} days` : '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              From application to decision
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Wait Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.averageWaitingDays ? `${stats.averageWaitingDays} days` : '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              Mean waiting period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.approvalRate !== null ? `${stats?.approvalRate}%` : '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              Based on reported outcomes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* By Route */}
        <Card>
          <CardHeader>
            <CardTitle>Waiting Time by Route</CardTitle>
            <CardDescription>Median days by application route</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.byRoute && stats.byRoute.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.byRoute}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="route" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="medianDays" fill="hsl(var(--primary))" name="Median Days" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Month */}
        <Card>
          <CardHeader>
            <CardTitle>Cases by Month</CardTitle>
            <CardDescription>Decisions in the last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.byMonth && stats.byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="month" 
                    fontSize={12}
                    tickFormatter={(value) => {
                      const [year, month] = value.split('-');
                      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      return monthNames[parseInt(month, 10) - 1] || value;
                    }}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" name="Cases" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Route breakdown table */}
      {stats?.byRoute && stats.byRoute.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Route Breakdown</CardTitle>
            <CardDescription>Detailed statistics by application route</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted">
                  <tr>
                    <th className="px-6 py-3">Route</th>
                    <th className="px-6 py-3 text-right">Cases</th>
                    <th className="px-6 py-3 text-right">Median Days</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byRoute.map((row) => (
                    <tr key={row.route} className="border-b">
                      <td className="px-6 py-4 font-medium">{row.route}</td>
                      <td className="px-6 py-4 text-right">{row.count}</td>
                      <td className="px-6 py-4 text-right">
                        {row.medianDays !== null ? `${row.medianDays} days` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
