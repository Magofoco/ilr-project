import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, LineChart, Line } from "recharts";
import { TrendingUp, Database, Users } from "lucide-react";

const barData = [
  { nationality: "India", avgDays: 142 },
  { nationality: "Nigeria", avgDays: 168 },
  { nationality: "Pakistan", avgDays: 155 },
  { nationality: "Bangladesh", avgDays: 160 },
  { nationality: "S. Africa", avgDays: 130 },
  { nationality: "Philippines", avgDays: 125 },
];

const lineData = [
  { month: "Aug", days: 158 },
  { month: "Sep", days: 152 },
  { month: "Oct", days: 145 },
  { month: "Nov", days: 148 },
  { month: "Dec", days: 140 },
  { month: "Jan", days: 135 },
];

const barConfig = {
  avgDays: { label: "Avg. Days", color: "var(--color-primary)" },
};

const lineConfig = {
  days: { label: "Processing Days", color: "var(--color-chart-2)" },
};

const counters = [
  { icon: Database, label: "Data points", value: "12,847", sub: "from 6 forums" },
  { icon: Users, label: "Nationalities", value: "54", sub: "tracked globally" },
  { icon: TrendingUp, label: "Avg. processing", value: "142d", sub: "across all types" },
];

const StatsSection = () => {
  return (
    <section id="stats" className="border-y bg-muted/30 py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">Live Data</p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            Processing time insights
          </h2>
          <p className="text-base text-muted-foreground">
            Updated daily from real applicant reports across UK immigration forums.
          </p>
        </div>

        {/* Counters */}
        <div className="mx-auto mb-14 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {counters.map((stat) => (
            <Card key={stat.label} className="border bg-card/80 shadow-none backdrop-blur-sm">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <stat.icon className="h-5 w-5 text-accent-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none text-foreground">{stat.value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{stat.sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                By Nationality
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={barConfig} className="h-[260px] w-full">
                <BarChart data={barData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <XAxis dataKey="nationality" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="avgDays" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="border bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                6-Month Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={lineConfig} className="h-[260px] w-full">
                <LineChart data={lineData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="days"
                    stroke="var(--color-chart-2)"
                    strokeWidth={2}
                    dot={{ fill: "var(--color-chart-2)", r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
