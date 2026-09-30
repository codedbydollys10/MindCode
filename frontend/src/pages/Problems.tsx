import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Filter, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import DifficultyBadge from "@/components/DifficultyBadge";

const allProblems = [
  { id: 1, title: "Two Sum", difficulty: "Easy" as const, acceptance: "49.2%", solved: true, tags: ["Array", "Hash Table"], frequency: 95 },
  { id: 2, title: "Add Two Numbers", difficulty: "Medium" as const, acceptance: "40.1%", solved: true, tags: ["Linked List", "Math"], frequency: 80 },
  { id: 3, title: "Longest Substring Without Repeating Characters", difficulty: "Medium" as const, acceptance: "33.8%", solved: false, tags: ["String", "Sliding Window"], frequency: 88 },
  { id: 4, title: "Median of Two Sorted Arrays", difficulty: "Hard" as const, acceptance: "38.0%", solved: false, tags: ["Array", "Binary Search"], frequency: 72 },
  { id: 5, title: "Longest Palindromic Substring", difficulty: "Medium" as const, acceptance: "32.4%", solved: false, tags: ["String", "DP"], frequency: 76 },
  { id: 6, title: "Zigzag Conversion", difficulty: "Medium" as const, acceptance: "43.8%", solved: true, tags: ["String"], frequency: 40 },
  { id: 7, title: "Reverse Integer", difficulty: "Medium" as const, acceptance: "27.5%", solved: false, tags: ["Math"], frequency: 65 },
  { id: 8, title: "String to Integer (atoi)", difficulty: "Medium" as const, acceptance: "16.8%", solved: false, tags: ["String"], frequency: 55 },
  { id: 9, title: "Palindrome Number", difficulty: "Easy" as const, acceptance: "53.3%", solved: true, tags: ["Math"], frequency: 60 },
  { id: 10, title: "Regular Expression Matching", difficulty: "Hard" as const, acceptance: "28.2%", solved: false, tags: ["String", "DP"], frequency: 70 },
  { id: 11, title: "Container With Most Water", difficulty: "Medium" as const, acceptance: "54.3%", solved: false, tags: ["Array", "Two Pointers"], frequency: 82 },
  { id: 12, title: "Integer to Roman", difficulty: "Medium" as const, acceptance: "61.2%", solved: true, tags: ["Math", "String"], frequency: 35 },
  { id: 13, title: "Roman to Integer", difficulty: "Easy" as const, acceptance: "58.2%", solved: true, tags: ["Math", "String"], frequency: 50 },
  { id: 14, title: "Longest Common Prefix", difficulty: "Easy" as const, acceptance: "41.0%", solved: false, tags: ["String"], frequency: 45 },
  { id: 15, title: "3Sum", difficulty: "Medium" as const, acceptance: "32.2%", solved: false, tags: ["Array", "Two Pointers"], frequency: 90 },
];

const Problems = () => {
  const [diffFilter, setDiffFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

  const filtered = allProblems.filter((p) => {
    if (diffFilter !== "All" && p.difficulty !== diffFilter) return false;
    if (statusFilter === "Solved" && !p.solved) return false;
    if (statusFilter === "Unsolved" && p.solved) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl font-bold text-foreground mb-6">Problems</h1>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="relative">
                <select
                  value={diffFilter}
                  onChange={(e) => setDiffFilter(e.target.value)}
                  className="appearance-none px-4 py-2 pr-8 rounded-btn bg-bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal/40"
                >
                  <option>All</option>
                  <option>Easy</option>
                  <option>Medium</option>
                  <option>Hard</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="appearance-none px-4 py-2 pr-8 rounded-btn bg-bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal/40"
                >
                  <option>All</option>
                  <option>Solved</option>
                  <option>Unsolved</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>

              <div className="relative flex-1 max-w-sm ml-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search problems..."
                  className="w-full pl-9 pr-4 py-2 rounded-btn bg-bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal/40"
                />
              </div>
            </div>

            {/* Problems Table */}
            <div className="glass-card rounded-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-3 px-5 text-left font-medium w-16">Status</th>
                      <th className="py-3 px-5 text-left font-medium">Title</th>
                      <th className="py-3 px-5 text-left font-medium">Tags</th>
                      <th className="py-3 px-5 text-left font-medium w-24">Difficulty</th>
                      <th className="py-3 px-5 text-left font-medium w-28">Acceptance</th>
                      <th className="py-3 px-5 text-left font-medium w-28">Frequency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors group">
                        <td className="py-3 px-5">
                          {p.solved ? <span className="text-teal">✓</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-3 px-5">
                          <Link to={`/assessment/${p.id}`} className="text-foreground hover:text-teal transition-colors">
                            {p.id}. {p.title}
                          </Link>
                        </td>
                        <td className="py-3 px-5">
                          <div className="flex gap-1 flex-wrap">
                            {p.tags.map((t) => (
                              <span key={t} className="px-2 py-0.5 rounded-badge bg-muted text-xs text-muted-foreground">{t}</span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-5"><DifficultyBadge difficulty={p.difficulty} /></td>
                        <td className="py-3 px-5 text-muted-foreground">{p.acceptance}</td>
                        <td className="py-3 px-5">
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-teal/60"
                              style={{ width: `${p.frequency}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">No problems found</div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Problems;
