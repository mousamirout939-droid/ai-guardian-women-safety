import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AuroraBackground } from "@/components/AuroraBackground";
import { AxiosError } from "axios";

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password needs at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      await signup(fullName, email, password, phone);
      navigate("/dashboard");
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      if (axiosErr.response?.status === 409) {
        setError("That email is already registered. Try signing in instead.");
      } else {
        setError("Something went wrong creating your account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
      <AuroraBackground />

      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <ShieldCheck className="h-6 w-6 text-beacon-500" />
          <span className="font-display text-lg font-semibold">Guardian Shield</span>
        </Link>

        <div className="glass-panel rounded-2xl p-8">
          <h1 className="mb-1 font-display text-2xl font-semibold">Create your account</h1>
          <p className="mb-6 text-sm text-ink-400">Takes less than a minute. Add trusted contacts after.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">
                Full name
              </label>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="glass-input w-full"
                placeholder="Jane Doe"
              />
            </div>
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
                Phone
              </label>
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="glass-input w-full"
                placeholder="+1 555 000 0000"
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
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-alarm-500/20 bg-alarm-500/10 px-3 py-2 text-sm text-alarm-400">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-beacon flex w-full items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create account
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-400">
          Already protected?{" "}
          <Link to="/login" className="font-medium text-signal-400 hover:text-signal-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
