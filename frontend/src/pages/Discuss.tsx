import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, ThumbsUp, MessageCircle, Eye, Clock, TrendingUp, Filter, Search, ChevronUp, Pin, Award } from "lucide-react";
import DashboardSidebar from "@/components/DashboardSidebar";
import DifficultyBadge from "@/components/DifficultyBadge";

const categories = ["All", "General", "Interview Experience", "Study Guide", "Problem Discussion", "Career", "Feedback"];

const threads = [
  {
    id: 1,
    title: "How I cracked Google L5 in 3 months using MindCode behavioral insights",
    author: "sarah_codes",
    avatar: "SC",
    category: "Interview Experience",
    time: "2h ago",
    views: 4200,
    likes: 187,
    replies: 43,
    pinned: true,
    tags: ["Google", "FAANG", "Interview"],
    preview: "I want to share my journey of preparing for Google's L5 position. The behavioral tracking feature helped me identify that I was spending too much time on edge cases...",
  },
  {
    id: 2,
    title: "DP Patterns Cheat Sheet — 7 patterns that cover 90% of problems",
    author: "algo_master",
    avatar: "AM",
    category: "Study Guide",
    time: "5h ago",
    views: 8900,
    likes: 432,
    replies: 67,
    pinned: true,
    tags: ["DP", "Patterns", "Guide"],
    preview: "After solving 300+ DP problems, I've identified 7 core patterns: Linear DP, Knapsack, LCS/LIS, Matrix Chain, Tree DP, Digit DP, and Bitmask DP...",
  },
  {
    id: 3,
    title: "Weekly Contest 391 Discussion Thread",
    author: "contest_bot",
    avatar: "CB",
    category: "Problem Discussion",
    time: "1d ago",
    views: 3100,
    likes: 89,
    replies: 156,
    pinned: false,
    tags: ["Contest", "Weekly"],
    preview: "Share your solutions, approaches, and discuss the problems from this week's contest. Problem D was particularly tricky...",
  },
  {
    id: 4,
    title: "Is it worth switching from LeetCode to MindCode?",
    author: "curious_dev",
    avatar: "CD",
    category: "General",
    time: "3d ago",
    views: 6700,
    likes: 201,
    replies: 89,
    pinned: false,
    tags: ["Comparison", "Discussion"],
    preview: "I've been using LeetCode Premium for 2 years. Just discovered MindCode and the behavioral analytics seem interesting. Has anyone used both?",
  },
  {
    id: 5,
    title: "My emotion detection showed I was 'confused' 60% of the time on Trees",
    author: "tree_hater",
    avatar: "TH",
    category: "Feedback",
    time: "4d ago",
    views: 2300,
    likes: 156,
    replies: 34,
    pinned: false,
    tags: ["Emotion Detection", "Trees"],
    preview: "The live analysis panel literally exposed my weakness. Turns out I understand the concepts but my implementation approach was all wrong...",
  },
  {
    id: 6,
    title: "Amazon SDE2 Interview — What to expect in 2026",
    author: "ex_amazonian",
    avatar: "EA",
    category: "Interview Experience",
    time: "5d ago",
    views: 5400,
    likes: 278,
    replies: 52,
    pinned: false,
    tags: ["Amazon", "SDE2", "Interview"],
    preview: "Just went through the full Amazon loop last month. Here's a detailed breakdown of each round, the types of questions asked, and how leadership principles factored in...",
  },
  {
    id: 7,
    title: "Graph algorithms visualized — interactive guide for beginners",
    author: "visual_learner",
    avatar: "VL",
    category: "Study Guide",
    time: "1w ago",
    views: 7200,
    likes: 345,
    replies: 28,
    pinned: false,
    tags: ["Graphs", "BFS", "DFS", "Beginner"],
    preview: "I created an interactive visualization for common graph algorithms. You can step through BFS, DFS, Dijkstra's, and Kruskal's algorithms...",
  },
];

const topContributors = [
  { name: "algo_master", posts: 234, likes: 12400, badge: "Expert" },
  { name: "sarah_codes", posts: 189, likes: 9800, badge: "Pro" },
  { name: "dp_wizard", posts: 156, likes: 8200, badge: "Expert" },
  { name: "graph_guru", posts: 134, likes: 7100, badge: "Pro" },
  { name: "code_ninja", posts: 98, likes: 5400, badge: "Rising" },
];

const Discuss = () => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"trending" | "newest" | "top">("trending");

  const filteredThreads = threads.filter((t) => {
    if (activeCategory !== "All" && t.category !== activeCategory) return false;
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 overflow-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-1">Discuss</h1>
                <p className="text-sm text-muted-foreground">Share solutions, ask questions, and learn from the community</p>
              </div>
              <button className="gradient-btn text-primary-foreground px-5 py-2 rounded-btn text-sm font-medium active:scale-[0.97] transition-transform">
                + New Post
              </button>
            </div>

            <div className="flex gap-6">
              {/* Main Content */}
              <div className="flex-1 min-w-0">
                {/* Category Pills */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-4 py-1.5 rounded-badge text-xs font-medium whitespace-nowrap transition-colors ${
                        activeCategory === cat
                          ? "bg-teal/15 text-teal border border-teal/30"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Search + Sort */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search discussions..."
                      className="w-full pl-9 pr-4 py-2 rounded-btn bg-bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal/40"
                    />
                  </div>
                  <div className="flex gap-1">
                    {(["trending", "newest", "top"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setSortBy(s)}
                        className={`px-3 py-2 rounded-btn text-xs font-medium capitalize transition-colors ${
                          sortBy === s ? "bg-teal/10 text-teal" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s === "trending" && <TrendingUp className="w-3 h-3 inline mr-1" />}
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Thread List */}
                <div className="space-y-3">
                  {filteredThreads.map((thread, i) => (
                    <motion.div
                      key={thread.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="glass-card rounded-card p-5 hover-lift cursor-pointer group"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-teal/10 flex items-center justify-center shrink-0 text-xs font-bold text-teal">
                          {thread.avatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {thread.pinned && (
                              <Pin className="w-3 h-3 text-gold" />
                            )}
                            <h3 className="font-semibold text-foreground group-hover:text-teal transition-colors line-clamp-1">
                              {thread.title}
                            </h3>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{thread.preview}</p>
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              <span className="text-foreground font-medium">{thread.author}</span> · {thread.time}
                            </span>
                            <span className="px-2 py-0.5 rounded-badge bg-muted text-[10px] text-muted-foreground">{thread.category}</span>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" /> {thread.likes}</span>
                              <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {thread.replies}</span>
                              <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {thread.views.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="flex gap-1 mt-2">
                            {thread.tags.map((t) => (
                              <span key={t} className="px-2 py-0.5 rounded-badge bg-muted text-[10px] text-muted-foreground">{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Right Sidebar */}
              <div className="w-64 shrink-0 hidden xl:block space-y-4">
                {/* Top Contributors */}
                <div className="glass-card rounded-card p-4 gradient-card">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Award className="w-4 h-4 text-gold" /> Top Contributors
                  </h3>
                  <div className="space-y-3">
                    {topContributors.map((c, i) => (
                      <div key={c.name} className="flex items-center gap-3">
                        <span className={`text-xs font-bold w-5 ${i < 3 ? "text-gold" : "text-muted-foreground"}`}>
                          #{i + 1}
                        </span>
                        <div className="w-7 h-7 rounded-full bg-teal/10 flex items-center justify-center text-[10px] font-bold text-teal">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">{c.name}</div>
                          <div className="text-[10px] text-muted-foreground">{c.likes.toLocaleString()} likes</div>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded-badge text-[9px] font-medium ${
                          c.badge === "Expert" ? "bg-gold/15 text-gold" :
                          c.badge === "Pro" ? "bg-teal/15 text-teal" :
                          "bg-ice/15 text-ice"
                        }`}>
                          {c.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trending Tags */}
                <div className="glass-card rounded-card p-4">
                  <h3 className="font-semibold text-foreground mb-3">Trending Tags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {["DP", "Graphs", "FAANG", "System Design", "Binary Search", "Two Pointers", "Trees", "Contest", "Interview Tips", "Backtracking"].map((t) => (
                      <span key={t} className="px-2.5 py-1 rounded-badge bg-muted text-xs text-muted-foreground hover:text-teal hover:bg-teal/10 cursor-pointer transition-colors">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Discuss;
