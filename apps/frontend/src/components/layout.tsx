import { Link, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Table2, Settings, LogOut, LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: BarChart3 },
  { name: 'Cases', href: '/cases', icon: Table2 },
];

const adminNavigation = [
  { name: 'Admin', href: '/admin', icon: Settings },
];

export function Layout() {
  const location = useLocation();
  const { user, isAdmin, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <Link to="/" className="mr-6 flex items-center space-x-2">
            <BarChart3 className="h-6 w-6" />
            <span className="font-bold">ILR Tracker</span>
          </Link>

          <nav className="flex items-center space-x-6 text-sm font-medium flex-1">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'transition-colors hover:text-foreground/80',
                  location.pathname === item.href ? 'text-foreground' : 'text-foreground/60'
                )}
              >
                {item.name}
              </Link>
            ))}
            {isAdmin &&
              adminNavigation.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'transition-colors hover:text-foreground/80',
                    location.pathname === item.href ? 'text-foreground' : 'text-foreground/60'
                  )}
                >
                  {item.name}
                </Link>
              ))}
          </nav>

          <div className="flex items-center space-x-2">
            {user ? (
              <>
                <span className="text-sm text-muted-foreground">{user.email}</span>
                <Button variant="ghost" size="sm" onClick={signOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign in
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t py-6 md:py-0">
        <div className="container flex flex-col items-center justify-between gap-4 md:h-14 md:flex-row">
          <p className="text-sm text-muted-foreground">
            Data sourced from public immigration forums. Not affiliated with UK Home Office.
          </p>
        </div>
      </footer>
    </div>
  );
}
