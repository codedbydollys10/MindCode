import { useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Clock, Users, Star, ChevronRight, Calendar, Medal, Timer, ArrowUp } from "lucide-react";
import DashboardSidebar from "@/components/DashboardSidebar";
import GlowButton from "@/components/GlowButton";

const upcomingContests = [
  {
    id: 1,
    title: "Weekly Contest 392",
    date: "Apr 12, 2026 · 10:30 AM UTC",
    duration: "1h 30m",
    participants: 0,
    registered: true,
    status: "upcoming",
    startsIn: "2d 14h",
  },
  {
    id: 2,
    title: "Biweekly Contest 128",
    date: "Apr 19, 2026 · 2:30 PM UTC",
    duration: "1h 30m",
    participants: 0,
    registered: false,
    status: "upcoming",
    startsIn: "9d 14h",
  },
];

const liveContest = {
  id: 0,
  title: "Weekly Contest 391",
  endTime: "42:18",
  participants: 14289,
  problems: [
    { id: "A", title: "Find Target Indices", solved: 12800, points: 3 },
    { id: "B", title: "Minimum Operations to Sort", solved: 8400, points: 4 },
    { id: "C", title: "Maximum Score Subarray", solved: 3200, points: 5 },
    { id: "D", title: "Count Palindrome Subsequences", solved: 890, points: 7 },
  ],
};

const pastContests = [
  { id: 390, title: "Weekly Contest 390", date: "Mar 29, 2026", rank: 1247, score: 14, total: 19, participants: 18420 },
  { id: 389, title: "Weekly Contest 389", date: "Mar 22, 2026", rank: 892, score: 19, total: 19, participants: 16800 },
  { id: 127, title: "Biweekly Contest 127", date: "Mar 15, 2026", rank: 2103, score: 12, total: 19, participants: 14200 },
  { id: 388, title: "Weekly Contest 388", date: "Mar 8, 2026", rank: null, score: 0, total: 19, participants: 17500 },
  { id: 387, title: "Weekly Contest 387", date: "Mar 1, 2026", rank: 3401, score: 7, total: 19, participants: 15900 },
];

const contestStats = { rating: 1847, maxRating: 1923, attended: 24, topPercent: 12 };

const Contest = () => {
  const [tab, setTab] = useState<"live" | "upcoming" | "past">("live");

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 overflow-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-1">Contest</h1>
                <p className="text-sm text-muted-foreground">Compete with developers worldwide</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="glass-card rounded-card px-4 py-2 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-gold" />
                  <span className="text-sm font-medium text-foreground">{contestStats.rating}</span>
                  <span className="text-xs text-muted-foreground">Rating</span>
                </div>
                <div className="glass-card rounded-card px-4 py-2 flex items-center gap-2">
                  <Medal className="w-4 h-4 text-teal" />
                  <span className="text-sm font-medium text-foreground">Top {contestStats.topPercent}%</span>
                </div>
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Contest Rating", value: contestStats.rating.toString(), icon: Trophy, color: "text-gold" },
                { label: "Max Rating", value: contestStats.maxRating.toString(), icon: ArrowUp, color: "text-teal" },
                { label: "Contests Attended", value: contestStats.attended.toString(), icon: Calendar, color: "text-ice" },
                { label: "Global Ranking", value: `Top ${contestStats.topPercent}%`, icon: Star, color: "text-gold" },
              ].map((s) => (
                <div key={s.label} className="glass-card rounded-card p-4 gradient-card">
                  <div className="flex items-center gap-2 mb-2">
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                  </div>
                  <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 border-b border-border">
              {(["live", "upcoming", "past"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors ${
                    tab === t ? "text-teal border-b-2 border-teal" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "live" && <span className="inline-flex items-center gap-1.5">{t} <span className="w-2 h-2 rounded-full bg-rose animate-pulse" /></span>}
                  {t !== "live" && t}
                </button>
              ))}
            </div>

            {/* Live Contest */}
            {tab === "live" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="glass-card rounded-card overflow-hidden border border-rose/20 glow-danger">
                  <div className="p-5 border-b border-border flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full bg-rose animate-pulse" />
                        <span className="text-xs font-medium text-rose uppercase tracking-wider">Live Now</span>
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">{liveContest.title}</h3>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Timer className="w-4 h-4 text-gold" />
                        <span className="font-mono text-gold text-lg">{liveContest.endTime}</span>
                        <span className="text-xs text-muted-foreground">remaining</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Users className="w-4 h-4" />
                        {liveContest.participants.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-3 px-5 text-left font-medium w-16">#</th>
                        <th className="py-3 px-5 text-left font-medium">Problem</th>
                        <th className="py-3 px-5 text-right font-medium w-24">Solved</th>
                        <th className="py-3 px-5 text-right font-medium w-20">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveContest.problems.map((p) => (
                        <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                          <td className="py-3 px-5 font-mono text-teal">{p.id}</td>
                          <td className="py-3 px-5 text-foreground">{p.title}</td>
                          <td className="py-3 px-5 text-right text-muted-foreground">{p.solved.toLocaleString()}</td>
                          <td className="py-3 px-5 text-right font-medium text-foreground">{p.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-4 border-t border-border flex justify-center">
                    <GlowButton size="sm">Enter Contest <ChevronRight className="w-3 h-3 ml-1" /></GlowButton>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Upcoming */}
            {tab === "upcoming" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                {upcomingContests.map((c) => (
                  <div key={c.id} className="glass-card rounded-card p-5 gradient-card flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-card bg-ice/10 flex items-center justify-center">
                        <Trophy className="w-6 h-6 text-ice" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{c.title}</h3>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {c.date}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {c.duration}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-xs text-muted-foreground">Starts in</span>
                        <div className="font-mono text-sm text-gold">{c.startsIn}</div>
                      </div>
                      <GlowButton variant={c.registered ? "ghost" : "primary"} size="sm">
                        {c.registered ? "Registered ✓" : "Register"}
                      </GlowButton>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {/* Past */}
            {tab === "past" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="glass-card rounded-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-3 px-5 text-left font-medium">Contest</th>
                        <th className="py-3 px-5 text-left font-medium">Date</th>
                        <th className="py-3 px-5 text-right font-medium">Rank</th>
                        <th className="py-3 px-5 text-right font-medium">Score</th>
                        <th className="py-3 px-5 text-right font-medium">Participants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pastContests.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                          <td className="py-3 px-5 text-foreground font-medium">{c.title}</td>
                          <td className="py-3 px-5 text-muted-foreground">{c.date}</td>
                          <td className="py-3 px-5 text-right">
                            {c.rank ? (
                              <span className={c.rank < 1000 ? "text-teal font-medium" : "text-foreground"}>#{c.rank.toLocaleString()}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 px-5 text-right">
                            <span className="text-foreground">{c.score}</span>
                            <span className="text-muted-foreground">/{c.total}</span>
                          </td>
                          <td className="py-3 px-5 text-right text-muted-foreground">{c.participants.toLocaleString()}</td>
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

export default Contest;
