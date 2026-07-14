import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthActions } from "../hooks/useAuthActions";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { useQuery } from "../hooks/useQuery";

export function LoginPage() {
  const { login } = useAuthActions();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: methods } = useQuery<{ local: boolean; oidc: boolean }>("/api/auth/methods");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";
      navigate(isAdmin ? "/admin" : "/portal", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-accent-strong font-mono text-sm font-bold text-zinc-950">
            K
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">OpenKey</h1>
            <p className="text-xs text-zinc-500">Self-hosted LLM gateway</p>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-5">
          <div className="mb-4">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div className="mb-5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
            />
          </div>
          {error && (
            <p role="alert" className="mb-4 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            Sign in
          </Button>
          {methods?.oidc && (
            <>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-2xs text-zinc-600">or</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              <a
                href="/api/auth/oidc/login"
                className="flex h-[34px] w-full items-center justify-center rounded border border-line-strong bg-surface-2 text-sm font-medium text-zinc-200 hover:bg-surface-3"
              >
                Continue with SSO
              </a>
            </>
          )}
        </form>
        <p className="mt-4 text-center text-2xs text-zinc-600">
          Your prompts, logs and spend never leave this deployment.
        </p>
      </div>
    </div>
  );
}
