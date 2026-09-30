import Navbar from "@/components/Navbar";
import { useAssessmentSession, formatDate } from "@/hooks/useAssessmentSession";
import GlowButton from "@/components/GlowButton";
import { FileText } from "lucide-react";
import { useEffect } from "react";
import { downloadBrandedReportPdf } from "@/lib/reportPdf";
import { Link } from "react-router-dom";

const Reports = () => {
  const { reports, loadReports } = useAssessmentSession();

  useEffect(() => {
    loadReports().catch(() => {});
  }, [loadReports]);

  const downloadAll = () => {
    if (!reports.length) return;
    downloadBrandedReportPdf(reports, "mindcode-branded-reports.pdf");
  };

  const downloadOne = (reportId: string) => {
    const report = reports.find((r) => r.id === reportId);
    if (!report) return;
    downloadBrandedReportPdf([report], `mindcode-report-${report.id}.pdf`);
  };

  const avgFocusFromTimeline = (focusPoints: Array<{ focus: number }> = []) => {
    if (!focusPoints.length) return 0;
    return Math.round(
      (focusPoints.reduce((sum, point) => sum + Number(point.focus || 0), 0) / Math.max(1, focusPoints.length)) || 0
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 pt-24 pb-12 space-y-6">
        <div className="relative overflow-hidden rounded-card border border-border bg-[radial-gradient(120%_120%_at_0%_0%,rgba(20,184,166,0.14),transparent_50%),radial-gradient(120%_120%_at_100%_100%,rgba(16,185,129,0.12),transparent_55%)] p-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">AI + Behavioral Insights</p>
            <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          </div>
          <GlowButton size="sm" onClick={downloadAll} disabled={!reports.length}>Download All Branded PDF</GlowButton>
        </div>

        <div className="glass-card rounded-card overflow-hidden border border-border shadow-[0_8px_30px_rgba(20,184,166,0.10)]">
          <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground bg-white/5">
            <FileText className="w-4 h-4 text-teal" /> {reports.length || 0} saved reports
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-3 px-5 text-left font-medium">Date</th>
                  <th className="py-3 px-5 text-left font-medium">Problem</th>
                  <th className="py-3 px-5 text-left font-medium">Language</th>
                  <th className="py-3 px-5 text-left font-medium">Focus</th>
                  <th className="py-3 px-5 text-left font-medium">PDF</th>
                  <th className="py-3 px-5 text-left font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 && (
                  <tr>
                    <td className="py-4 px-5 text-muted-foreground" colSpan={6}>No reports yet. Run an assessment to generate one.</td>
                  </tr>
                )}
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-hover/70 transition-colors">
                    <td className="py-3 px-5 text-foreground">{formatDate(r.createdAt)}</td>
                    <td className="py-3 px-5 text-foreground font-medium">{r.problemTitle}</td>
                    <td className="py-3 px-5 uppercase text-muted-foreground">{r.language}</td>
                    <td className="py-3 px-5 text-teal font-medium">{avgFocusFromTimeline(r.behaviorTimeline)}%</td>
                    <td className="py-3 px-5">
                      <button className="text-teal hover:underline" onClick={() => downloadOne(r.id)}>Download</button>
                    </td>
                    <td className="py-3 px-5 text-teal"><Link to={`/result/${r.id}`} className="hover:underline">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Reports;
