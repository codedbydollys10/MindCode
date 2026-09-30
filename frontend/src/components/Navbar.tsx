import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Brain, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const studentLinks = [
  { label: "Home", to: "/dashboard" },
  { label: "Practice", to: "/practice" },
  { label: "Report", to: "/reports" },
  { label: "AI Insights", to: "/recommendations" },
  { label: "History", to: "/history" },
  { label: "Profile", to: "/profile" },
];

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const visibleLinks = studentLinks;

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-background/80 backdrop-blur-xl border-b border-border"
          : "bg-transparent"
      )}
    >
      <nav className="container mx-auto grid grid-cols-[1fr,auto,1fr] items-center h-16 px-4">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground">MindCode</span>
        </Link>

        <div className="hidden md:flex items-center gap-3 justify-center">
          {visibleLinks.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-btn transition-colors",
                location.pathname === link.to
                  ? "text-teal bg-teal/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-bg-hover"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-end md:hidden">
          <button
            className="text-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="md:hidden bg-background/95 backdrop-blur-xl border-b border-border p-4 space-y-2">
          {visibleLinks.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className="block px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-btn"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
};

export default Navbar;
