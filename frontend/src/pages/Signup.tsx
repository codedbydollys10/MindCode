import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Brain, Eye, EyeOff, Check } from "lucide-react";
import GlowButton from "@/components/GlowButton";
import useSupabaseAuth from "@/hooks/useSupabaseAuth";

const Signup = () => {
  const [showPw, setShowPw] = useState(false);
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const { signUpWithPassword, loading, error } = useSupabaseAuth();
  const [notice, setNotice] = useState<string | null>(null);

  const strength = pw.length === 0 ? 0 : pw.length < 6 ? 1 : pw.length < 10 ? 2 : /[A-Z].*\d|[0-9].*[A-Z]/.test(pw) ? 4 : 3;
  const strengthColors = ["bg-muted", "bg-rose", "bg-gold", "bg-teal", "bg-teal"];

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (pw !== confirmPw) {
      alert("Passwords do not match");
      return;
    }
    try {
      const data = await signUpWithPassword(email, pw, name.trim() || undefined);
      if (data.session) {
        navigate("/dashboard");
        return;
      }
      setNotice("Account created. Please verify your email, then log in.");
      navigate("/login");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left */}
      <div className="hidden lg:flex flex-col justify-center w-1/2 bg-bg-surface p-12">
        <Link to="/" className="flex items-center gap-2 mb-12">
          <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground">MindCode</span>
        </Link>
        <h2 className="text-3xl font-bold text-foreground mb-6">Decode how you think.</h2>
        <div className="space-y-4">
          {["AI-powered behavioral analytics", "Real-time coding insights", "Skill DNA reports"].map((t) => (
            <div key={t} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-teal/15 flex items-center justify-center">
                <Check className="w-3 h-3 text-teal" />
              </div>
              <span className="text-muted-foreground">{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-1">Create Account</h1>
          <p className="text-sm text-muted-foreground mb-6">Start your coding journey with behavioral insights</p>

        <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="text-sm text-foreground mb-1 block">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg bg-bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                placeholder="Ada Lovelace"
              />
            </div>
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
              <label className="text-sm text-foreground mb-1 block">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal/40 pr-10"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {pw.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strengthColors[strength] : "bg-muted"}`} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm text-foreground mb-1 block">Confirm Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg bg-bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                placeholder="••••••••"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="rounded border-border accent-teal" />
              I agree to the Terms of Service and Privacy Policy
            </label>

            {error && <p className="text-sm text-rose">{error}</p>}
            {notice && <p className="text-sm text-teal">{notice}</p>}

            <GlowButton type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Creating account..." : "Create Account"}
            </GlowButton>
          </form>

          <p className="text-sm text-muted-foreground text-center mt-6">
            Already a member? <Link to="/login" className="text-teal hover:underline">Log in</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Signup;
