import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Home, History, FileText, Target, ChevronLeft, ChevronRight, Brain, Lightbulb, Code2
} from "lucide-react";
import { cn } from "@/lib/utils";

const sidebarItems = [
  { icon: Home, label: "Dashboard", to: "/dashboard" },
  { icon: Code2, label: "Collaborate", to: "/collaborate" },
  { icon: FileText, label: "Reports", to: "/reports" },
  { icon: Lightbulb, label: "AI Insights", to: "/recommendations" },
  { icon: Target, label: "Practice", to: "/practice" },
  { icon: History, label: "History", to: "/history" },
];

type DashboardSidebarProps = {
  offsetTop?: boolean;
};

const DashboardSidebar = ({ offsetTop = false }: DashboardSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const visibleItems = sidebarItems;

  return (
    <aside
      className={cn(
        "bg-bg-surface border-r border-border flex flex-col transition-all duration-200",
        offsetTop ? "h-[calc(100vh-4rem)] sticky top-16" : "h-screen sticky top-0",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex items-center h-16 px-4 border-b border-border">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center shrink-0">
            <Brain className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && <span className="text-lg font-semibold text-foreground">MindCode</span>}
        </Link>
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1">
        {visibleItems.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-medium transition-colors",
                active
                  ? "bg-teal/10 text-teal border-l-2 border-teal"
                  : "text-muted-foreground hover:text-foreground hover:bg-bg-hover"
              )}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-10 border-t border-border text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
};

export default DashboardSidebar;
