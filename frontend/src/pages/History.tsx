import Navbar from "@/components/Navbar";
import { useAssessmentSession, formatDate } from "@/hooks/useAssessmentSession";
import { useEffect } from "react";
import { Activity, Clock, Target } from "lucide-react";

const History = () => {
  const { reports, loadReports } = useAssessmentSession();

  useEffect(() => {
    loadReports().catch(() => {});
  }, [loadReports]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 pt-24 pb-12 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Chronology of your assessments</p>
            <h1 className="text-3xl font-bold">History</h1>
          </div>
        </div>

        <div className="space-y-4">
          {reports.length === 0 && <p className="text-muted-foreground">No history yet. Run an assessment to populate this timeline.</p>}
          {reports.map((r) => (
            <div key={r.id} className="glass-card rounded-card p-4 border border-border flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-teal mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" /> {formatDate(r.createdAt)}
                </div>
                <p className="text-foreground font-semibold">{r.problemTitle}</p>
                <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Focus {Math.round(r.skillScores.focus)}%</span>
                  <span className="flex items-center gap-1"><Target className="w-3 h-3" /> Debug {Math.round(r.skillScores.debugging)}%</span>
                  <span className="uppercase">{r.language}</span>
                </div>
              </div>
              <a className="text-teal text-sm hover:underline" href={`/result/${r.id}`}>Report</a>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default History;
