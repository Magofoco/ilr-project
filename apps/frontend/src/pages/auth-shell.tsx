import type { ReactNode } from 'react';

/**
 * Shared chrome for /login and /signup. Provides the gradient-mesh
 * background and a centered, max-w-md column matching the landing-page
 * brand language.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Gradient mesh — same idiom as the hero */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary/6 blur-3xl" />
        <div className="absolute -bottom-32 right-1/4 h-[360px] w-[360px] rounded-full bg-chart-2/5 blur-3xl" />
      </div>

      <div className="relative flex w-full max-w-sm flex-col items-center">
        {children}
      </div>
    </div>
  );
}
