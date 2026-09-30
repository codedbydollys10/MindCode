import { motion } from "framer-motion";
import { Users, Target, Building, TrendingUp, Brain, Eye, Keyboard, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import GlowButton from "@/components/GlowButton";

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

const stats = [
  { value: "48K+", label: "Developers", icon: Users },
  { value: "94%", label: "Accuracy", icon: Target },
  { value: "200+", label: "Companies", icon: Building },
  { value: "3×", label: "Hiring Signal", icon: TrendingUp },
];

const features = [
  {
    icon: Brain,
    title: "Behavioral Tracking",
    desc: "Monitor keystrokes, pauses, and problem-solving patterns in real-time.",
  },
  {
    icon: Sparkles,
    title: "AI Skill DNA Report",
    desc: "Get a comprehensive breakdown of coding strengths and growth areas.",
  },
  {
    icon: Eye,
    title: "Live Emotion Detection",
    desc: "Client-side facial analysis detects focus, confusion, and flow states.",
  },
];

const pricingPlans = [
  { name: "Free", price: "$0", features: ["50 problems", "Basic analytics", "Community access"], cta: "Get Started" },
  { name: "Pro", price: "$19", features: ["Unlimited problems", "AI reports", "Behavioral tracking", "Emotion detection", "PDF export"], cta: "Start Free Trial", popular: true },
  { name: "Enterprise", price: "Custom", features: ["Everything in Pro", "Team dashboard", "API access", "SSO", "Dedicated support"], cta: "Contact Sales" },
];

const Landing = () => {
  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg gradient-btn flex items-center justify-center">
              <span className="text-lg font-bold text-primary-foreground">M</span>
            </div>
            <span className="text-lg font-semibold text-foreground">MindCode</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="px-4 py-2 rounded-btn text-sm text-foreground border border-border hover:bg-bg-hover">
              Log In
            </Link>
            <Link to="/signup">
              <GlowButton size="sm">Sign Up</GlowButton>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 dot-pattern opacity-[0.04]" />
        <div className="container mx-auto px-4 relative">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="max-w-3xl mx-auto text-center"
          >
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-badge bg-teal/10 border border-teal/20 mb-6">
              <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
              <span className="text-sm font-medium text-teal">AI-Powered Assessment</span>
            </motion.div>

            <motion.h1 variants={fadeUp} className="text-4xl md:text-6xl font-bold text-foreground leading-tight mb-6">
              We don't just test code.{" "}
              <span className="text-gradient-hero">We decode thinking.</span>
            </motion.h1>

            <motion.p variants={fadeUp} className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              MindCode combines coding challenges with behavioral intelligence to reveal how developers truly think, not just what they output.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-6 mt-12">
              {stats.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-sm">
                  <s.icon className="w-4 h-4 text-teal" />
                  <span className="font-semibold text-foreground">{s.value}</span>
                  <span className="text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-t border-border">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold text-foreground mb-3">Beyond Code Evaluation</h2>
            <p className="text-muted-foreground">Tools that LeetCode doesn't have.</p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass-card rounded-card p-6 gradient-card hover-lift group"
              >
                <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center mb-4 group-hover:glow-primary transition-all">
                  <f.icon className="w-5 h-5 text-teal" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-3">Simple Pricing</h2>
            <p className="text-muted-foreground">Start free, upgrade when you need more.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-card p-6 border transition-all hover-lift ${
                  plan.popular
                    ? "border-teal/40 glow-primary bg-bg-surface"
                    : "border-border glass-card"
                }`}
              >
                {plan.popular && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-badge text-xs font-medium bg-teal/15 text-teal mb-3">
                    Most Popular
                  </span>
                )}

                <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                <div className="mt-2 mb-4">
                  <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                  {plan.price !== "Custom" && <span className="text-muted-foreground text-sm">/mo</span>}
                </div>

                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-teal" />
                      {f}
                    </li>
                  ))}
                </ul>

                <GlowButton
                  variant={plan.popular ? "primary" : "ghost"}
                  className="w-full"
                  size="sm"
                >
                  {plan.cta}
                </GlowButton>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Landing;
