import { useState } from "react";
import { motion } from "framer-motion";
import { Briefcase, ChevronRight, Clock, Code2, Star, Users, Building, MapPin, DollarSign, CheckCircle, TrendingUp, Target } from "lucide-react";
import { Link } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import DifficultyBadge from "@/components/DifficultyBadge";
import GlowButton from "@/components/GlowButton";

const companies = [
  { name: "Google", problems: 892, logo: "G", color: "text-teal" },
  { name: "Amazon", problems: 756, logo: "A", color: "text-gold" },
  { name: "Meta", problems: 634, logo: "M", color: "text-ice" },
  { name: "Apple", problems: 412, logo: "Ap", color: "text-foreground" },
  { name: "Microsoft", problems: 589, logo: "Ms", color: "text-teal" },
  { name: "Netflix", problems: 198, logo: "N", color: "text-rose" },
];

const interviewPacks = [
  {
    id: "sde1",
    title: "SDE I — New Grad",
    description: "Essential problems for entry-level software engineering roles",
    problems: 75,
    hours: 50,
    difficulty: "Easy" as const,
    topics: ["Arrays", "Strings", "Linked Lists", "Trees", "Sorting"],
    progress: 48,
  },
  {
    id: "sde2",
    title: "SDE II — Mid-Level",
    description: "Challenging problems covering system design and advanced algorithms",
    problems: 100,
    hours: 80,
    difficulty: "Medium" as const,
    topics: ["DP", "Graphs", "Design", "Greedy", "Backtracking"],
    progress: 22,
  },
  {
    id: "senior",
    title: "Senior / Staff Engineer",
    description: "Complex problems requiring optimization and system-level thinking",
    problems: 60,
    hours: 100,
    difficulty: "Hard" as const,
    topics: ["Advanced DP", "Network Flow", "Segment Trees", "System Design"],
    progress: 0,
  },
];

const mockInterviews = [
  { id: 1, title: "45-Min Technical Screen", duration: "45 min", problems: 2, difficulty: "Medium" as const, type: "Timed" },
  { id: 2, title: "Full Loop Simulation", duration: "3 hours", problems: 5, difficulty: "Hard" as const, type: "Marathon" },
  { id: 3, title: "Behavioral + Coding Combo", duration: "60 min", problems: 2, difficulty: "Medium" as const, type: "Mixed" },
  { id: 4, title: "Speed Round", duration: "20 min", problems: 4, difficulty: "Easy" as const, type: "Sprint" },
];

const recentInterviews = [
  { company: "Google", role: "L4 SDE", date: "Apr 5, 2026", score: 87, result: "pass" },
  { company: "Meta", role: "E4 SDE", date: "Mar 28, 2026", score: 72, result: "pass" },
  { company: "Amazon", role: "SDE II", date: "Mar 20, 2026", score: 64, result: "fail" },
];

const Interview = () => {
  const [tab, setTab] = useState<"prep" | "mock" | "history">("prep");

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 overflow-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl font-bold text-foreground mb-1">Interview Prep</h1>
            <p className="text-sm text-muted-foreground mb-8">Company-specific practice, mock interviews, and AI-powered feedback</p>

            {/* Tabs */}
            <div className="flex gap-1 mb-8 border-b border-border">
              {(["prep", "mock", "history"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors ${
                    tab === t ? "text-teal border-b-2 border-teal" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "prep" ? "Preparation" : t === "mock" ? "Mock Interview" : "History"}
                </button>
              ))}
            </div>

            {tab === "prep" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                {/* Company Cards */}
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Building className="w-5 h-5 text-teal" /> Company-Specific Problems
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {companies.map((c) => (
                      <div key={c.name} className="glass-card rounded-card p-4 hover-lift cursor-pointer text-center group">
                        <div className={`w-12 h-12 mx-auto mb-3 rounded-card bg-bg-hover flex items-center justify-center text-lg font-bold ${c.color} group-hover:glow-primary transition-all`}>
                          {c.logo}
                        </div>
                        <h4 className="text-sm font-medium text-foreground mb-0.5">{c.name}</h4>
                        <span className="text-xs text-muted-foreground">{c.problems} problems</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Interview Packs */}
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Target className="w-5 h-5 text-ice" /> Interview Packs
                  </h2>
                  <div className="grid md:grid-cols-3 gap-4">
                    {interviewPacks.map((pack, i) => (
                      <motion.div
                        key={pack.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="glass-card rounded-card p-5 gradient-card hover-lift"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <DifficultyBadge difficulty={pack.difficulty} />
                          {pack.progress > 0 && (
                            <span className="text-xs text-teal font-medium">{pack.progress}%</span>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground mb-1">{pack.title}</h3>
                        <p className="text-xs text-muted-foreground mb-3">{pack.description}</p>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                          <span className="flex items-center gap-1"><Code2 className="w-3 h-3" /> {pack.problems}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {pack.hours}h</span>
                        </div>

                        {pack.progress > 0 && (
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
                            <div className="h-full rounded-full bg-gradient-to-r from-teal to-ice" style={{ width: `${pack.progress}%` }} />
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1 mb-4">
                          {pack.topics.slice(0, 3).map((t) => (
                            <span key={t} className="px-2 py-0.5 rounded-badge bg-muted text-[10px] text-muted-foreground">{t}</span>
                          ))}
                          {pack.topics.length > 3 && (
                            <span className="px-2 py-0.5 rounded-badge bg-muted text-[10px] text-muted-foreground">+{pack.topics.length - 3}</span>
                          )}
                        </div>

                        <GlowButton size="sm" className="w-full" variant={pack.progress > 0 ? "primary" : "ghost"}>
                          {pack.progress > 0 ? "Continue" : "Start Pack"}
                        </GlowButton>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Tips */}
                <div className="glass-card rounded-card p-5 border border-teal/15">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-teal" /> AI Interview Tips
                  </h3>
                  <div className="grid md:grid-cols-3 gap-4">
                    {[
                      { tip: "Practice talking through your approach before coding. MindCode's behavioral tracking shows candidates who verbalize score 23% higher.", icon: "💡" },
                      { tip: "Your pause patterns suggest you rush into Hard problems. Try spending 3 more minutes planning before the first keystroke.", icon: "⏱️" },
                      { tip: "Your Graph performance is in the 40th percentile. Focus on BFS/DFS patterns to move into the 70th+ for your target companies.", icon: "📈" },
                    ].map((t, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="text-xl">{t.icon}</span>
                        <p className="text-xs text-muted-foreground leading-relaxed">{t.tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {tab === "mock" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <p className="text-sm text-muted-foreground mb-4">Simulate real interview conditions with timed sessions, behavioral tracking, and AI feedback.</p>
                <div className="grid md:grid-cols-2 gap-4">
                  {mockInterviews.map((m) => (
                    <div key={m.id} className="glass-card rounded-card p-5 gradient-card hover-lift">
                      <div className="flex items-start justify-between mb-3">
                        <span className={`px-2.5 py-0.5 rounded-badge text-xs font-medium ${
                          m.type === "Timed" ? "bg-gold/15 text-gold" :
                          m.type === "Marathon" ? "bg-rose/15 text-rose" :
                          m.type === "Sprint" ? "bg-teal/15 text-teal" :
                          "bg-ice/15 text-ice"
                        }`}>
                          {m.type}
                        </span>
                        <DifficultyBadge difficulty={m.difficulty} />
                      </div>
                      <h3 className="font-semibold text-foreground mb-2">{m.title}</h3>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {m.duration}</span>
                        <span className="flex items-center gap-1"><Code2 className="w-3 h-3" /> {m.problems} problems</span>
                      </div>
                      <GlowButton size="sm" className="w-full">Start Mock <ChevronRight className="w-3 h-3 ml-1" /></GlowButton>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {tab === "history" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="glass-card rounded-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-3 px-5 text-left font-medium">Company</th>
                        <th className="py-3 px-5 text-left font-medium">Role</th>
                        <th className="py-3 px-5 text-left font-medium">Date</th>
                        <th className="py-3 px-5 text-center font-medium">Score</th>
                        <th className="py-3 px-5 text-center font-medium">Result</th>
                        <th className="py-3 px-5 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentInterviews.map((r, i) => (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                          <td className="py-3 px-5 font-medium text-foreground">{r.company}</td>
                          <td className="py-3 px-5 text-muted-foreground">{r.role}</td>
                          <td className="py-3 px-5 text-muted-foreground">{r.date}</td>
                          <td className="py-3 px-5 text-center">
                            <span className={r.score >= 70 ? "text-teal font-medium" : "text-gold font-medium"}>{r.score}%</span>
                          </td>
                          <td className="py-3 px-5 text-center">
                            <span className={`px-2.5 py-0.5 rounded-badge text-xs font-medium ${
                              r.result === "pass" ? "bg-mint/15 text-mint" : "bg-rose/15 text-rose"
                            }`}>
                              {r.result === "pass" ? "Passed" : "Failed"}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button className="text-xs text-teal hover:underline">View Report</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Interview;
