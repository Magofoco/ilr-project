import { Link, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Calculator, Table2, Settings, LogOut, LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: BarChart3 },
  { name: 'Estimator', href: '/estimate', icon: Calculator },
  { name: 'Cases', href: '/cases', icon: Table2 },
];

const adminNavigation = [
  { name: 'Admin', href: '/admin', icon: Settings },
];

export function Layout() {
  const location = useLocation();
  const { user, isAdmin, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
        <div className="container mx-auto flex h-14 items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <span className="font-display text-base font-bold text-foreground">
              ILR Tracker
            </span>
          </Link>

          <nav className="hidden flex-1 items-center gap-6 text-xs font-medium md:flex">
            {[...navigation, ...(isAdmin ? adminNavigation : [])].map((item) => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'relative py-1 transition-colors',
                    active
                      ? 'text-foreground after:absolute after:-bottom-[15px] after:left-0 after:h-[2px] after:w-full after:bg-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <>
                <span className="hidden text-xs text-muted-foreground md:inline">
                  {user.email}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={signOut}
                >
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
                  <Link to="/login">
                    <LogIn className="mr-1.5 h-3.5 w-3.5" />
                    Sign in
                  </Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="h-8 rounded-lg px-4 text-xs font-semibold"
                >
                  <Link to="/signup">Sign up</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto flex-1 px-4 py-8 md:py-10">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground md:h-14 md:flex-row md:py-0">
          <p>
            Built from public UK immigration forum posts. Not affiliated with
            the Home Office.
          </p>
          <p>
            <strong className="font-medium text-foreground">
              Statistics, not immigration advice.
            </strong>
          </p>
        </div>
      </footer>
    </div>
  );
}
