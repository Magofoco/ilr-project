import { Search, BarChart3, Filter } from "lucide-react";

const steps = [
  {
    icon: Search,
    num: "01",
    title: "Collect",
    description: "Forums are continuously scraped for ILR application updates, approvals, and decision timelines.",
  },
  {
    icon: BarChart3,
    num: "02",
    title: "Analyse",
    description: "Dates, nationalities, visa categories, and outcomes are extracted into structured, searchable data.",
  },
  {
    icon: Filter,
    num: "03",
    title: "Discover",
    description: "Filter timelines by your nationality and visa type to see realistic processing expectations.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="bg-background py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">How It Works</p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            From forum posts to clarity
          </h2>
          <p className="text-base text-muted-foreground">
            Three steps between scattered forum data and the answers you need.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-0 md:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.num} className="relative flex flex-col items-center px-8 py-10 text-center">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute right-0 top-1/2 hidden h-px w-full -translate-y-1/2 bg-border md:block md:w-px md:h-full md:translate-y-0 md:top-0" />
              )}
              <span className="mb-4 font-display text-4xl font-bold text-primary/15">{step.num}</span>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <step.icon className="h-5 w-5 text-accent-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
