import { Search, BarChart3, Filter } from "lucide-react";

const steps = [
  {
    icon: Search,
    num: "01",
    title: "We read the forums",
    description:
      "Every day we collect public posts where applicants share their ILR timeline — when they applied, when they gave fingerprints, when they got a decision.",
  },
  {
    icon: BarChart3,
    num: "02",
    title: "We turn them into data",
    description:
      "Dates, visa routes, nationalities and outcomes are pulled into a clean dataset. No usernames are kept. Source links are preserved so you can always read the original.",
  },
  {
    icon: Filter,
    num: "03",
    title: "You get a real answer",
    description:
      "Filter by route, nationality and where you give fingerprints, and we tell you the typical wait among people like you — including the ones still waiting.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="bg-background py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
            How it works
          </p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            From forum posts to a real answer
          </h2>
          <p className="text-base text-muted-foreground">
            Three steps between scattered forum data and the answer you actually
            need.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-0 md:grid-cols-3">
          {steps.map((step, i) => (
            <div
              key={step.num}
              className="relative flex flex-col items-center px-8 py-10 text-center"
            >
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute right-0 top-1/2 hidden h-px w-full -translate-y-1/2 bg-border md:block md:h-full md:w-px md:top-0 md:translate-y-0" />
              )}
              <span className="mb-4 font-display text-4xl font-bold text-primary/15">
                {step.num}
              </span>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <step.icon className="h-5 w-5 text-accent-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
