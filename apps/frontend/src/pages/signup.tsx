import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { BarChart3, CheckCircle2 } from 'lucide-react';
import { AuthShell } from './auth-shell';
import { GoogleSignInButton } from '@/components/google-sign-in-button';

export function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const { error } = await signUp(email, password);
      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthShell>
        <Link to="/" className="mb-8 inline-flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <span className="font-display text-base font-bold text-foreground">
            ILR Tracker
          </span>
        </Link>

        <Card className="w-full shadow-xl shadow-foreground/4">
          <CardHeader className="space-y-2 pb-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <CheckCircle2 className="h-6 w-6 text-accent-foreground" />
            </div>
            <CardTitle className="font-display text-2xl">
              Check your email
            </CardTitle>
            <CardDescription>
              We&rsquo;ve sent a confirmation link to{' '}
              <strong className="text-foreground">{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Click the link in the email to verify your account and complete
              signup.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Return to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Link to="/" className="mb-8 inline-flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <span className="font-display text-base font-bold text-foreground">
          ILR Tracker
        </span>
      </Link>

      <Card className="w-full shadow-xl shadow-foreground/4">
        <CardHeader className="space-y-1 pb-4 text-center">
          <CardTitle className="font-display text-2xl">
            Create your account
          </CardTitle>
          <CardDescription>
            Get personalised ILR waiting-time estimates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleSignInButton label="Sign up with Google" onError={setError} />

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              or
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="confirmPassword"
                className="text-xs text-muted-foreground"
              >
                Confirm password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full shadow-md shadow-primary/20"
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            By signing up you agree we&rsquo;ll show you statistics, not
            immigration advice.
          </p>

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">
              Already have an account?{' '}
            </span>
            <Link
              to="/login"
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>

      <Link
        to="/"
        className="mt-6 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to home
      </Link>
    </AuthShell>
  );
}
