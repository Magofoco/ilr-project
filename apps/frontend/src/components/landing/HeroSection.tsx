import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Globe, Shield } from "lucide-react";
import { Link } from "react-router-dom";

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-background">
      {/* Gradient mesh background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-0 h-[500px] w-[500px] rounded-full bg-primary/[0.04] blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-[400px] w-[400px] rounded-full bg-chart-2/[0.05] blur-3xl" />
      </div>

      <div className="container relative mx-auto px-4 pb-16 pt-24 md:pb-28 md:pt-36">
        <div className="mx-auto max-w-3xl text-center">
          {/* Pill badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Live UK Immigration Data
          </div>

          {/* Headline */}
          <h1 className="mb-6 text-5xl font-bold leading-[1.08] text-foreground md:text-7xl">
            Know your{" "}
            <span className="relative inline-block text-primary">
              ILR timeline
              <svg className="absolute -bottom-1 left-0 w-full" height="6" viewBox="0 0 200 6" fill="none">
                <path d="M0 3C50 0.5 150 0.5 200 3" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </span>
            <br />
            before you apply
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Processing times aggregated from thousands of real forum posts — 
            filtered by nationality, visa type, and date.
          </p>

          {/* CTAs */}
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 gap-2 rounded-lg px-8 text-sm font-semibold shadow-lg shadow-primary/20 transition-shadow hover:shadow-xl hover:shadow-primary/25">
              <Link to="/dashboard">
                Explore Timelines
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 gap-2 px-8 text-sm font-medium text-muted-foreground"
              onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
            >
              See how it works
            </Button>
          </div>

          {/* Trust strip */}
          <div className="mt-20 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-xs tracking-wide text-muted-foreground uppercase">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Updated daily
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-primary" />
              100% anonymous
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-primary" />
              50+ nationalities
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
