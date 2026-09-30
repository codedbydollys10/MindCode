import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import GlowButton from "@/components/GlowButton";
import Navbar from "@/components/Navbar";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  // If this page should appear right after signup, keep the navbar consistent.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.15),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.2),transparent_40%),radial-gradient(circle_at_40%_80%,rgba(56,189,248,0.18),transparent_40%)]" />
        <div className="max-w-4xl mx-auto px-4 pt-28 pb-16 relative">
          <div className="glass-card rounded-3xl border border-border/80 shadow-2xl p-8 md:p-10 backdrop-blur-xl bg-bg-surface/80">
            <div className="flex items-center gap-2 text-sm text-teal mb-4">
              <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
              <span>You're in. Let's activate your dashboard.</span>
            </div>

            <div className="grid md:grid-cols-[1.2fr,0.8fr] gap-8 items-center">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-badge bg-teal/10 border border-teal/30 text-xs text-teal">
                  <Sparkles className="w-4 h-4" /> MindCode ready
                </div>
                <h1 className="text-3xl md:text-4xl font-bold leading-tight">Welcome aboard, builder.</h1>
                <p className="text-muted-foreground text-base">
                  Your cognitive dashboard is set. Kick off your first guided assessment to generate a personalized Skill DNA profile,
                  activity heatmap, and focus signals. You can always tweak languages and difficulty later.
                </p>
                <div className="grid sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
                  {[
                    "Behavioral tracking enabled",
                    "Anti-cheat guardrails on",
                    "Live radar & reports",
                    "Export-ready PDFs",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2 bg-bg-hover/60 border border-border rounded-btn px-3 py-2">
                      <CheckCircle2 className="w-4 h-4 text-teal" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <GlowButton size="lg" onClick={() => navigate("/dashboard")}>
                    Start <ArrowRight className="w-4 h-4 ml-2" />
                  </GlowButton>
                  <button
                    className="px-4 py-2 rounded-btn border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/60"
                    onClick={() => navigate("/profile")}
                  >
                    Review profile
                  </button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 blur-3xl bg-gradient-to-br from-teal/20 via-ice/20 to-indigo-400/20" />
                <div className="relative rounded-2xl border border-border bg-bg-hover/70 p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-foreground">Session preview</p>
                    <span className="text-xs text-muted-foreground">~12 min</span>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Language</span>
                      <span className="px-2 py-1 rounded-badge bg-teal/10 text-teal text-xs">Python</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Difficulty</span>
                      <span className="px-2 py-1 rounded-badge bg-ice/10 text-ice text-xs">Medium</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Signals</span>
                      <span>Focus, keystrokes, pauses</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Report</span>
                      <span className="text-foreground font-medium">Skill DNA + Heatmap</span>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-border bg-gradient-to-r from-teal/15 to-indigo-500/10 p-4">
                    <p className="text-xs text-muted-foreground mb-1">Outcome</p>
                    <p className="text-sm font-semibold text-foreground">Sharpen your signal, shorten the next review loop.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
