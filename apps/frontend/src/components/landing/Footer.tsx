import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t bg-background py-10">
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          <div className="text-center md:text-left">
            <p className="font-display text-base font-bold text-foreground">ILR Timelines</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              UK immigration processing data, simplified.
            </p>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
            {["Stats", "How It Works", "Dashboard", "Testimonials", "FAQ"].map((label) => (
              <a
                key={label}
                href={`#${label.toLowerCase().replace(/ /g, "-")}`}
                className="transition-colors hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>

          <Button asChild size="sm" className="h-9 gap-1.5 rounded-lg px-5 text-xs font-semibold">
            <Link to="/dashboard">
              Get Started <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>

        <div className="mt-8 text-center text-[11px] text-muted-foreground">
          &copy; {new Date().getFullYear()} ILR Timelines. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
