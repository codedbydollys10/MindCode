import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Brain, Eye, EyeOff, Check } from "lucide-react";
import GlowButton from "@/components/GlowButton";
import useSupabaseAuth from "@/hooks/useSupabaseAuth";

const Login = () => {
  const [showPw, setShowPw] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const { signInWithPassword, resendSignupConfirmation, loading, error } = useSupabaseAuth();

  const needsConfirmation = Boolean(error && /confirm|confirmed|verify/i.test(error));

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await signInWithPassword(email, password);
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      setNotice("Enter your email first, then click resend.");
      return;
    }
    try {
      await resendSignupConfirmation(email);
      setNotice("Verification email sent. Please check your inbox.");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-col justify-center w-1/2 bg-bg-surface p-12">
        <Link to="/" className="flex items-center gap-2 mb-12">
          <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground">MindCode</span>
        </Link>
        <h2 className="text-3xl font-bold text-foreground mb-6">Welcome back.</h2>
        <div className="space-y-4">
          {["Track your progress over time", "Pick up where you left off", "AI-powered growth insights"].map((t) => (
            <div key={t} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-teal/15 flex items-center justify-center">
                <Check className="w-3 h-3 text-teal" />
              </div>
              <span className="text-muted-foreground">{t}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-1">Welcome back</h1>
          <p className="text-sm text-muted-foreground mb-6">Log in to continue your coding journey</p>

        <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="text-sm text-foreground mb-1 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg bg-bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-foreground">Password</label>
              </div>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal/40 pr-10"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="rounded border-border accent-teal" />
              Remember me
            </label>

            {error && <p className="text-sm text-rose">{error}</p>}
            {notice && <p className="text-sm text-teal">{notice}</p>}
            {needsConfirmation && (
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={loading}
                className="text-sm text-teal hover:underline disabled:opacity-60"
              >
                Resend verification email
              </button>
            )}

            <GlowButton type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Signing in..." : "Log In"}
            </GlowButton>
          </form>

          <p className="text-sm text-muted-foreground text-center mt-6">
            New to MindCode? <Link to="/signup" className="text-teal hover:underline">Sign up</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
