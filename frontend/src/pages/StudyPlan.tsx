import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { BookOpen, Clock, CheckCircle, ChevronRight, Flame, Target, Zap, TrendingUp, Code2, Brain } from "lucide-react";
import DashboardSidebar from "@/components/DashboardSidebar";
import DifficultyBadge from "@/components/DifficultyBadge";
import GlowButton from "@/components/GlowButton";

const studyPlans = [
  {
    id: "dsa-crash",
    title: "DSA Crash Course",
    description: "Master fundamental data structures and algorithms in 14 days",
    icon: Zap,
    problems: 45,
    hours: 28,
    progress: 62,
    difficulty: "Easy" as const,
    tags: ["Arrays", "Strings", "Linked Lists", "Stacks", "Queues"],
    enrolled: 12400,
  },
  {
    id: "30-day",
    title: "30-Day Coding Challenge",
    description: "Daily problems that progressively increase in difficulty",
    icon: Flame,
    problems: 30,
    hours: 40,
    progress: 33,
    difficulty: "Medium" as const,
    tags: ["Mixed Topics", "Daily Challenge"],
    enrolled: 8700,
  },
  {
    id: "graph-mastery",
    title: "Graph Mastery",
    description: "Deep dive into graph algorithms: BFS, DFS, shortest path, topological sort",
    icon: Target,
    problems: 35,
    hours: 45,
    progress: 0,
    difficulty: "Hard" as const,
    tags: ["BFS", "DFS", "Dijkstra", "Union Find"],
    enrolled: 5200,
  },
  {
    id: "dp-patterns",
    title: "Dynamic Programming Patterns",
    description: "Learn the 7 core DP patterns with curated problem sets",
    icon: Brain,
    problems: 50,
    hours: 60,
    progress: 14,
    difficulty: "Hard" as const,
    tags: ["1D DP", "2D DP", "Knapsack", "LCS", "MCM"],
    enrolled: 9800,
  },
  {
    id: "top-interview",
    title: "Top Interview 150",
    description: "The most frequently asked problems at top tech companies",
    icon: TrendingUp,
    problems: 150,
    hours: 100,
    progress: 45,
    difficulty: "Medium" as const,
    tags: ["FAANG", "System Design", "OOP"],
    enrolled: 22000,
  },
  {
    id: "sql-50",
    title: "SQL 50",
    description: "Essential SQL problems from basic SELECT to advanced window functions",
    icon: Code2,
    problems: 50,
    hours: 20,
    progress: 80,
    difficulty: "Easy" as const,
    tags: ["SELECT", "JOIN", "Subqueries", "Window Functions"],
    enrolled: 15300,
  },
];

const dailyProblem = {
  id: 217,
  title: "Contains Duplicate",
  difficulty: "Easy" as const,
  tags: ["Array", "Hash Table", "Sorting"],
  acceptance: "61.2%",
};

const StudyPlan = () => {
  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 overflow-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl font-bold text-foreground mb-1">Study Plans</h1>
            <p className="text-sm text-muted-foreground mb-8">Structured learning paths to level up your skills</p>

            {/* Daily Challenge Banner */}
            <div className="glass-card rounded-card p-5 gradient-card mb-8 border border-teal/15">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-card bg-teal/10 flex items-center justify-center">
                    <Flame className="w-6 h-6 text-teal" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-teal uppercase tracking-wider">Daily Challenge</span>
                      <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                    </div>
                    <h3 className="font-semibold text-foreground">{dailyProblem.id}. {dailyProblem.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <DifficultyBadge difficulty={dailyProblem.difficulty} />
                      {dailyProblem.tags.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-badge bg-muted text-[10px] text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <Link to={`/assessment/${dailyProblem.id}`}>
                  <GlowButton size="sm">Solve Now <ChevronRight className="w-3 h-3 ml-1" /></GlowButton>
                </Link>
              </div>
            </div>

            {/* Active Plans */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-teal" /> Your Active Plans
              </h2>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {studyPlans.filter(p => p.progress > 0).map((plan, i) => (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="glass-card rounded-card p-5 gradient-card hover-lift group cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center group-hover:glow-primary transition-all">
                        <plan.icon className="w-5 h-5 text-teal" />
                      </div>
                      <DifficultyBadge difficulty={plan.difficulty} />
                    </div>
                    <h3 className="font-semibold text-foreground mb-1">{plan.title}</h3>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{plan.description}</p>
                    
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                      <span className="flex items-center gap-1"><Code2 className="w-3 h-3" /> {plan.problems} problems</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {plan.hours}h</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-teal to-ice transition-all" style={{ width: `${plan.progress}%` }} />
                      </div>
                      <span className="text-xs font-medium text-teal">{plan.progress}%</span>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-3">
                      {plan.tags.slice(0, 3).map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-badge bg-muted text-[10px] text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* All Plans */}
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-ice" /> Explore Plans
              </h2>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {studyPlans.filter(p => p.progress === 0).map((plan, i) => (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="glass-card rounded-card p-5 gradient-card hover-lift group cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-ice/10 flex items-center justify-center">
                        <plan.icon className="w-5 h-5 text-ice" />
                      </div>
                      <DifficultyBadge difficulty={plan.difficulty} />
                    </div>
                    <h3 className="font-semibold text-foreground mb-1">{plan.title}</h3>
                    <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                      <span className="flex items-center gap-1"><Code2 className="w-3 h-3" /> {plan.problems} problems</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {plan.hours}h</span>
                      <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {plan.enrolled.toLocaleString()} enrolled</span>
                    </div>
                    <GlowButton size="sm" className="w-full">Start Plan</GlowButton>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default StudyPlan;
