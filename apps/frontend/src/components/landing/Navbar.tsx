import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { Link } from "react-router-dom";
import { BarChart3, LogOut } from "lucide-react";

const Navbar = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <span className="font-display text-base font-bold text-foreground">ILR Timelines</span>
        </Link>

        {/* Section links — hidden on mobile */}
        <nav className="hidden items-center gap-6 text-xs font-medium text-muted-foreground md:flex">
          {[
            { label: "Stats", href: "#stats" },
            { label: "How It Works", href: "#how-it-works" },
            { label: "Dashboard", href: "#preview" },
            { label: "FAQ", href: "#faq" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Auth buttons */}
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm" className="text-xs">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={signOut}>
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="text-xs">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="h-8 rounded-lg px-4 text-xs font-semibold">
                <Link to="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
