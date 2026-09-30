import { cn } from "@/lib/utils";

type Difficulty = "Easy" | "Medium" | "Hard";

const DifficultyBadge = ({ difficulty }: { difficulty: Difficulty }) => {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-badge text-xs font-medium",
        difficulty === "Easy" && "bg-mint/15 text-mint",
        difficulty === "Medium" && "bg-gold/15 text-gold",
        difficulty === "Hard" && "bg-rose/15 text-rose"
      )}
    >
      {difficulty}
    </span>
  );
};

export default DifficultyBadge;
