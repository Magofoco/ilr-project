const rows = [
  { nat: "\u{1F1EE}\u{1F1F3} India", date: "12 Jan 2026", status: "Approved", days: "134" },
  { nat: "\u{1F1F3}\u{1F1EC} Nigeria", date: "08 Jan 2026", status: "Pending", days: "152" },
  { nat: "\u{1F1F5}\u{1F1F0} Pakistan", date: "05 Jan 2026", status: "Approved", days: "148" },
  { nat: "\u{1F1FF}\u{1F1E6} South Africa", date: "28 Dec 2025", status: "Approved", days: "121" },
  { nat: "\u{1F1E7}\u{1F1E9} Bangladesh", date: "22 Dec 2025", status: "Approved", days: "139" },
];

const DashboardPreview = () => {
  return (
    <section id="preview" className="border-y bg-muted/30 py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">Dashboard</p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            Everything in one place
          </h2>
          <p className="text-base text-muted-foreground">
            Filter, explore, and export ILR processing data with an intuitive dashboard.
          </p>
        </div>

        {/* Browser chrome */}
        <div className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-xl border bg-card shadow-2xl shadow-foreground/5">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(0 60% 67%)" }} />
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(40 80% 63%)" }} />
                <div className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(130 50% 56%)" }} />
              </div>
              <div className="ml-3 flex-1 rounded-md bg-background px-3 py-1 text-[11px] text-muted-foreground">
                ilr-timelines.co.uk/dashboard
              </div>
            </div>

            {/* Dashboard body */}
            <div className="p-5 md:p-8">
              {/* Metric cards */}
              <div className="mb-6 grid grid-cols-3 gap-3">
                {[
                  { label: "Pending", value: "234", change: "+12 this week" },
                  { label: "Approved", value: "1,847", change: "+89 this month" },
                  { label: "Avg. Wait", value: "138d", change: "\u2193 4 days" },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border bg-background p-4">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="mt-1 text-xl font-bold text-foreground">{m.value}</p>
                    <p className="mt-0.5 text-[10px] text-primary">{m.change}</p>
                  </div>
                ))}
              </div>

              {/* Table header */}
              <div className="mb-2 grid grid-cols-4 gap-4 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Nationality</span>
                <span>Date</span>
                <span>Status</span>
                <span className="text-right">Days</span>
              </div>

              {/* Table rows */}
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <div key={row.nat} className="grid grid-cols-4 gap-4 rounded-lg border bg-background px-4 py-2.5 text-sm">
                    <span className="font-medium text-foreground">{row.nat}</span>
                    <span className="text-muted-foreground">{row.date}</span>
                    <span className={row.status === "Approved" ? "font-medium text-primary" : "text-muted-foreground"}>
                      {row.status}
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">{row.days}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DashboardPreview;
