import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout';
import { Landing } from './pages/landing';
import { Dashboard } from './pages/dashboard';
import { Cases } from './pages/cases';
import { Login } from './pages/login';
import { Signup } from './pages/signup';
import { AuthCallback } from './pages/auth-callback';
import { Admin } from './pages/admin';
import { useAuth } from './lib/auth-context';

// ============================================
// AUTH WRAPPERS (layout-level, not per-route)
// ============================================

/**
 * Layout route that requires authentication.
 * All child routes are automatically protected.
 * To add a new protected page, just add a <Route> child — no wrapper needed.
 */
function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Layout />;
}

/**
 * Layout route that requires admin role.
 * Inherits auth check from ProtectedLayout pattern,
 * then additionally checks isAdmin.
 */
function AdminLayout() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Render children inside the shared Layout
  return <Layout />;
}

/**
 * Redirect authenticated users away from auth pages to /dashboard.
 */
function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

// ============================================
// ROUTES
// ============================================

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />

      {/* Guest-only (redirect to dashboard if logged in) */}
      <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
      <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/*
        Protected routes — requires valid Supabase session.
        To add a new page: just add a <Route> here. That's it.
      */}
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/cases" element={<Cases />} />
      </Route>

      {/*
        Admin routes — requires Supabase session + admin role.
        To add a new admin page: just add a <Route> here.
      */}
      <Route element={<AdminLayout />}>
        <Route path="/admin" element={<Admin />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
