import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AuroraBackground } from "@/components/AuroraBackground";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch {
      setError("Email or password didn't match. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <AuroraBackground />

      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <ShieldCheck className="h-6 w-6 text-beacon-500" />
          <span className="font-display text-lg font-semibold">Guardian Shield</span>
        </Link>

        <div className="glass-panel rounded-2xl p-8">
          <h1 className="mb-1 font-display text-2xl font-semibold">Welcome back</h1>
          <p className="mb-6 text-sm text-ink-400">Sign in to your safety dashboard.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="glass-input w-full"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="glass-input w-full"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-alarm-500/20 bg-alarm-500/10 px-3 py-2 text-sm text-alarm-400">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-beacon flex w-full items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-400">
          New to Guardian Shield?{" "}
          <Link to="/signup" className="font-medium text-signal-400 hover:text-signal-300">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
