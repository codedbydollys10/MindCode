import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const GlowButton = forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center font-medium transition-all duration-200 rounded-btn active:scale-[0.97]",
          variant === "primary" &&
            "gradient-btn text-primary-foreground glow-primary hover:shadow-[0_0_40px_rgba(0,212,170,0.25)]",
          variant === "ghost" &&
            "bg-transparent border border-border text-foreground hover:bg-bg-hover hover:border-[hsl(var(--border-bright))]",
          variant === "danger" &&
            "bg-destructive text-destructive-foreground glow-danger",
          size === "sm" && "px-4 py-2 text-sm",
          size === "md" && "px-6 py-2.5 text-sm",
          size === "lg" && "px-8 py-3 text-base",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

GlowButton.displayName = "GlowButton";
export default GlowButton;
