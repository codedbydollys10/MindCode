import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  icon?: React.ReactNode;
  accent?: "teal" | "rose" | "gold" | "ice";
}

const StatCard = ({ label, value, suffix = "", prefix = "", icon, accent = "teal" }: StatCardProps) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const duration = 1600;
    const steps = 60;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "glass-card rounded-card p-5 gradient-card hover-lift",
        accent === "teal" && "hover:glow-primary",
        accent === "rose" && "hover:glow-danger"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-muted-foreground text-sm">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn(
          "text-2xl font-bold",
          accent === "teal" && "text-teal",
          accent === "rose" && "text-rose",
          accent === "gold" && "text-gold",
          accent === "ice" && "text-ice",
        )}>
          {prefix}{count.toLocaleString()}{suffix}
        </span>
      </div>
    </motion.div>
  );
};

export default StatCard;
