import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { useAssessmentSession, formatDate, type AssessmentReport } from "@/hooks/useAssessmentSession";
import { downloadBrandedReportPdf } from "@/lib/reportPdf";
import { filterAndSortReports, focusStatus, getReportFocus, getReportLanguage, getReportMetrics, type ReportDateFilter, type ReportFocusFilter, type ReportSort } from "@/lib/reportDashboardUtils";
import { toast } from "@/components/ui/sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowLeft, ArrowRight, BookOpen, CalendarDays, ChartNoAxesCombined, ChevronDown, CirclePause, CirclePlay, Clock3, FileText, Languages, Loader2, Search, Sparkles, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

const PAGE_SIZE = 10;

const Reports = () => {
  const { reports, reportCount, loadReports } = useAssessmentSession();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [dateFilter, setDateFilter] = useState<ReportDateFilter>("all");
  const [focusFilter, setFocusFilter] = useState<ReportFocusFilter>("all");
  const [sort, setSort] = useState<ReportSort>("newest");
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const refreshReports = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      await loadReports();
    } catch (error) {
      console.error("[Reports] Unable to load reports:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [loadReports]);

  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);

  const metrics = useMemo(() => getReportMetrics(reports), [reports]);
  const totalReportCount = reportCount ?? metrics.totalReports;
  const languages = useMemo(() => [...new Set(reports.map(getReportLanguage).map((item) => item.toLowerCase()).filter(Boolean))].sort(), [reports]);
  const filteredReports = useMemo(() => filterAndSortReports(reports, {
    query, language, date: dateFilter, focus: focusFilter, sort,
  }), [reports, query, language, dateFilter, focusFilter, sort]);
  const pageCount = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleReports = filteredReports.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const trend = useMemo(() => [...reports]
    .filter((report) => getReportFocus(report) !== null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((report) => ({
      date: formatDate(report.createdAt),
      timestamp: report.createdAt,
      focus: getReportFocus(report),
      problem: report.problemTitle,
    })), [reports]);

  useEffect(() => {
    setPage(1);
  }, [query, language, dateFilter, focusFilter, sort]);

  const downloadAll = async () => {
    if (!reports.length || downloadingAll) return;
    setDownloadingAll(true);
    try {
      await downloadBrandedReportPdf(reports, "mindcode-branded-reports.pdf");
      toast.success("All loaded report PDFs downloaded.");
    } catch (error) {
      console.error("[Reports] Unable to download all report PDFs:", error);
      toast.error("Unable to generate the report PDF. Please try again.");
    } finally {
      setDownloadingAll(false);
    }
  };

  const downloadOne = async (report: AssessmentReport) => {
    if (downloadingId || downloadingAll) return;
    setDownloadingId(report.id);
    try {
      await downloadBrandedReportPdf([report], `mindcode-report-${report.id}.pdf`);
      toast.success("Report PDF downloaded.");
    } catch (error) {
      console.error("[Reports] Unable to download report PDF:", error);
      toast.error("Unable to generate the report PDF. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  const openReport = (reportId: string) => navigate(`/result/${encodeURIComponent(reportId)}`);
  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, reportId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openReport(reportId);
    }
  };

  const languageCountValue = metrics.languageCount > 0 ? String(metrics.languageCount) : "No data yet";
  const latestDate = metrics.latestReport
    ? isToday(metrics.latestReport.createdAt) ? "Today" : formatDate(metrics.latestReport.createdAt)
    : "No data yet";

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-7xl space-y-6 px-4 pb-12 pt-24 sm:px-6">
        <header className="flex flex-col justify-between gap-5 rounded-card border border-border bg-bg-surface p-5 shadow-lg shadow-black/10 sm:flex-row sm:items-center sm:p-7">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-teal"><Sparkles className="h-4 w-4" />AI + Behavioral Insights</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Reports Overview</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Track your coding performance, behavioral insights and generated reports.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" className="border-teal/30 hover:border-teal/60">
              <Link to="/practice"><BookOpen className="mr-2 h-4 w-4 text-teal" />Generate New Report</Link>
            </Button>
            <Button onClick={() => void downloadAll()} title={totalReportCount > reports.length ? "Downloads all currently loaded reports (latest 50)." : "Downloads all saved reports."} disabled={!reports.length || downloadingAll || loading || loadError}>
              {downloadingAll ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparing PDFs...</> : <><ArrowDown className="mr-2 h-4 w-4" />Download All Branded PDF</>}
            </Button>
          </div>
        </header>

        {!loading && !loadError && totalReportCount > reports.length && (
          <p className="text-xs text-muted-foreground">
            This dashboard currently loads the latest {reports.length} reports. Filters, pagination, and PDF export apply to this loaded set.
          </p>
        )}

        {loadError && (
          <section role="alert" className="flex flex-col items-start justify-between gap-3 rounded-lg border border-rose/30 bg-rose/5 p-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold">Unable to load reports.</h2>
              <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again. Your reports remain private to your signed-in account.</p>
            </div>
            <Button variant="outline" onClick={() => void refreshReports()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Retry
            </Button>
          </section>
        )}

        {!loadError && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Report summary">
              <KpiCard icon={FileText} label="Total Reports" value={loading ? null : String(totalReportCount)} detail={loading ? "Loading saved reports" : "All saved assessment reports"} />
              <KpiCard icon={Target} label="Average Focus" value={loading ? null : metrics.averageFocus === null ? "No data yet" : `${metrics.averageFocus}%`} detail="Across latest 50 loaded reports" accent="blue" />
              <KpiCard icon={Languages} label="Languages" value={loading ? null : languageCountValue} detail="Distinct in latest 50 reports" />
              <KpiCard icon={Clock3} label="Latest Report" value={loading ? null : latestDate} detail={metrics.latestReport && !loading ? metrics.latestReport.problemTitle : "Most recent saved report"} accent="green" />
            </section>

            {!loading && reports.length > 0 && (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr),minmax(270px,0.9fr)]">
                <section className="min-w-0 rounded-card border border-border bg-bg-surface p-5 shadow-lg shadow-black/10 sm:p-6" aria-labelledby="performance-overview-title">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Performance</p>
                      <h2 id="performance-overview-title" className="mt-1 text-xl font-semibold">Focus Trend</h2>
                      <p className="mt-1 text-xs text-muted-foreground">Focus scores from the latest 50 loaded reports.</p>
                    </div>
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">{trend.length} scored report{trend.length === 1 ? "" : "s"}</span>
                  </div>
                  {trend.length >= 2 ? (
                    <div className="mt-4 h-64 w-full" role="img" aria-label="Focus score trend across saved reports">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trend} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
                          <defs>
                            <linearGradient id="focusTrendFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(var(--accent-teal))" stopOpacity={0.28} />
                              <stop offset="95%" stopColor="hsl(var(--accent-teal))" stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} width={34} />
                          <Tooltip
                            cursor={{ stroke: "hsl(var(--accent-teal))", strokeDasharray: "3 3" }}
                            contentStyle={{ backgroundColor: "hsl(var(--background))", borderColor: "hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.problem || "Report"}
                            formatter={(value) => [`${value}%`, "Focus"]}
                          />
                          <Area type="monotone" dataKey="focus" stroke="hsl(var(--accent-teal))" strokeWidth={2} fill="url(#focusTrendFill)" activeDot={{ r: 5 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <div className="mt-4 flex h-48 items-center justify-center rounded-lg border border-dashed border-border px-5 text-center text-sm text-muted-foreground">
                    Not enough data for a trend yet. A trend appears when at least two saved reports have focus scores.
                  </div>}
                </section>

                <section className="rounded-card border border-border bg-bg-surface p-5 shadow-lg shadow-black/10 sm:p-6" aria-labelledby="languages-title">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Report insights</p>
                    <h2 id="languages-title" className="mt-1 text-xl font-semibold">Languages Used</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Report count by language in the latest 50 loaded reports.</p>
                  </div>
                  <ul className="mt-4 space-y-3">
                    {languageSummary(reports).map(({ language: name, count }) => (
                      <li key={name}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium capitalize">{name}</span><span className="text-muted-foreground">{count}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-hover" role="progressbar" aria-label={`${name}: ${count} reports`} aria-valuenow={count} aria-valuemin={0} aria-valuemax={reports.length}>
                          <span className="block h-full rounded-full bg-teal" style={{ width: `${count / reports.length * 100}%` }} />
                        </div>
                      </li>
                    ))}
                    {!languages.length && <li className="text-sm text-muted-foreground">No language data yet.</li>}
                  </ul>
                </section>
              </div>
            )}

            <section className="overflow-hidden rounded-card border border-border bg-bg-surface shadow-lg shadow-black/10" aria-labelledby="saved-reports-title">
              <div className="flex flex-col justify-between gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal/10 text-teal"><FileText className="h-5 w-5" /></span>
                  <div>
                    <h2 id="saved-reports-title" className="text-lg font-semibold">Saved Reports</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{totalReportCount} report{totalReportCount === 1 ? "" : "s"} · latest {reports.length} loaded</p>
                  </div>
                </div>
                {!loading && reports.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ChartNoAxesCombined className="h-4 w-4 text-teal" />
                    <span>{filteredReports.length} matching report{filteredReports.length === 1 ? "" : "s"}</span>
                  </div>
                )}
              </div>

              {!loading && reports.length > 0 && <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1.6fr),repeat(4,minmax(130px,1fr))]">
                <label className="relative block sm:col-span-2 lg:col-span-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reports..." aria-label="Search reports"
                    className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <FilterSelect label="Language" value={language} onChange={setLanguage}>
                  <option value="all">All Languages</option>{languages.map((item) => <option key={item} value={item}>{capitalize(item)}</option>)}
                </FilterSelect>
                <FilterSelect label="Date range" value={dateFilter} onChange={(value) => setDateFilter(value as ReportDateFilter)}>
                  <option value="all">All Dates</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option><option value="year">This year</option>
                </FilterSelect>
                <FilterSelect label="Focus score" value={focusFilter} onChange={(value) => setFocusFilter(value as ReportFocusFilter)}>
                  <option value="all">Any Focus</option><option value="high">80% and above</option><option value="medium">50–79%</option><option value="low">Below 50%</option>
                </FilterSelect>
                <FilterSelect label="Sort reports" value={sort} onChange={(value) => setSort(value as ReportSort)}>
                  <option value="newest">Newest First</option><option value="oldest">Oldest First</option>
                  <option value="focus-high">Focus: High to Low</option><option value="focus-low">Focus: Low to High</option>
                  <option value="problem">Problem: A to Z</option><option value="language">Language: A to Z</option>
                </FilterSelect>
              </div>}

              {loading ? <ReportsLoading /> : reports.length === 0 ? (
                <div className="px-5 py-14 text-center sm:px-8">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal/10 text-teal"><FileText className="h-6 w-6" /></span>
                  <h3 className="mt-4 text-lg font-semibold">No reports yet</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Complete a coding assessment to generate your first report.</p>
                  <Button asChild className="mt-5"><Link to="/practice"><BookOpen className="mr-2 h-4 w-4" />Start Practice</Link></Button>
                </div>
              ) : filteredReports.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <Search className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-3 font-medium">No reports match those filters</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try a different search or reset the filters.</p>
                  <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setQuery(""); setLanguage("all"); setDateFilter("all"); setFocusFilter("all"); setSort("newest"); }}>Clear filters</Button>
                </div>
              ) : <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-background/70 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 font-medium"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Date</span></th>
                        <th className="px-5 py-3 font-medium">Problem</th><th className="px-5 py-3 font-medium">Language</th>
                        <th className="px-5 py-3 font-medium">Focus</th><th className="px-5 py-3 font-medium">PDF</th><th className="px-5 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReports.map((report) => {
                        const focus = getReportFocus(report);
                        return <tr key={report.id} role="link" tabIndex={0} aria-label={`Open report: ${report.problemTitle}`}
                          onClick={() => openReport(report.id)} onKeyDown={(event) => onRowKeyDown(event, report.id)}
                          className="cursor-pointer border-t border-border/70 transition-colors hover:bg-bg-hover/70 focus-visible:bg-bg-hover focus-visible:outline-none">
                          <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{formatDate(report.createdAt)}</td>
                          <td className="max-w-[280px] px-5 py-4"><span className="block truncate font-medium">{report.problemTitle}</span><span className="mt-0.5 block text-xs text-muted-foreground">{capitalize(report.difficulty)} assessment</span></td>
                          <td className="px-5 py-4">{getReportLanguage(report) ? <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium uppercase tracking-wide">{getReportLanguage(report)}</span> : <span className="text-muted-foreground">No data yet</span>}</td>
                          <td className="px-5 py-4"><FocusVisual focus={focus} /></td>
                          <td className="px-5 py-4">
                            <Button variant="ghost" size="sm" disabled={Boolean(downloadingId) || downloadingAll} aria-label={`Download PDF for ${report.problemTitle}`}
                              onClick={(event) => { event.stopPropagation(); void downloadOne(report); }}>
                              {downloadingId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ArrowDown className="mr-1.5 h-4 w-4" />PDF</>}
                            </Button>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); openReport(report.id); }}>
                              View Report<ArrowRight className="ml-2 h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 p-4 md:hidden">
                  {visibleReports.map((report) => {
                    const focus = getReportFocus(report);
                    return                     <article key={report.id} onClick={() => openReport(report.id)} onKeyDown={(event) => onRowKeyDown(event, report.id)}
                      role="link" tabIndex={0} aria-label={`Open report: ${report.problemTitle}`}
                      className="cursor-pointer rounded-lg border border-border bg-background p-4 transition-colors hover:border-teal/40 hover:bg-bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><h3 className="truncate font-semibold">{report.problemTitle}</h3><p className="mt-1 text-sm capitalize text-muted-foreground">{getReportLanguage(report) || "No language data"} · {capitalize(report.difficulty)}</p></div>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(report.createdAt)}</span>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <FocusVisual focus={focus} />
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" disabled={Boolean(downloadingId) || downloadingAll} onClick={(event) => { event.stopPropagation(); void downloadOne(report); }}>
                            {downloadingId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ArrowDown className="mr-1 h-4 w-4" />PDF</>}
                          </Button>
                          <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); openReport(report.id); }}>View<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    </article>;
                  })}
                </div>

                <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row sm:px-5">
                  <p className="text-xs text-muted-foreground">Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredReports.length)} of {filteredReports.length} loaded reports</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Previous</Button>
                    <span className="min-w-16 text-center text-xs text-muted-foreground">Page {currentPage} of {pageCount}</span>
                    <Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </>}
            </section>

            {!loading && metrics.latestReport && (
              <section className="grid gap-6 rounded-card border border-border bg-bg-surface p-5 shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal/40 hover:shadow-teal/5 motion-reduce:transform-none motion-reduce:transition-none sm:p-6 lg:grid-cols-[minmax(0,1fr),minmax(260px,300px)] lg:items-center" aria-label="Latest report">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-400/10 text-indigo-300"><FileText className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Latest Report</p>
                    <h2 className="mt-1 truncate text-lg font-semibold">{metrics.latestReport.problemTitle}</h2>
                    <p className="mt-1 text-sm capitalize text-muted-foreground">{getReportLanguage(metrics.latestReport) || "No language data"} · {formatDate(metrics.latestReport.createdAt)}</p>
                    <p className="mt-2 text-sm">Focus <span className="font-semibold text-teal">{getReportFocus(metrics.latestReport) === null ? "No data yet" : `${getReportFocus(metrics.latestReport)}%`}</span></p>
                    <Button className="mt-4" onClick={() => openReport(metrics.latestReport!.id)}>View Report<ArrowRight className="ml-2 h-4 w-4" /></Button>
                  </div>
                </div>
                <ReportInsightsVideo />
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

const KpiCard = ({ icon: Icon, label, value, detail, accent = "teal" }: {
  icon: typeof FileText;
  label: string;
  value: string | null;
  detail: string;
  accent?: "teal" | "blue" | "green";
}) => {
  const accentStyle = accent === "blue" ? "bg-sky-400/10 text-sky-300" : accent === "green" ? "bg-emerald-400/10 text-emerald-300" : "bg-teal/10 text-teal";
  return (
    <article className="rounded-card border border-border bg-bg-surface p-4 shadow-lg shadow-black/10 transition-colors hover:border-teal/30 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentStyle}`}><Icon className="h-4 w-4" /></span>
      </div>
      {value === null ? <div className="mt-4 h-8 w-24 animate-pulse rounded bg-bg-hover motion-reduce:animate-none" aria-label={detail} /> : <p className="mt-3 truncate text-2xl font-semibold tracking-tight">{value}</p>}
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </article>
  );
};

const FilterSelect = ({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) => (
  <label className="relative block">
    <span className="sr-only">{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-9 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </label>
);

const FocusVisual = ({ focus }: { focus: number | null }) => {
  if (focus === null) return <span className="text-sm text-muted-foreground">No data yet</span>;
  const bounded = Math.min(100, Math.max(0, focus));
  const status = focusStatus(bounded);
  return (
    <div className="flex min-w-24 items-center gap-2.5">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(hsl(var(--accent-teal)) ${bounded}%, hsl(var(--bg-hover)) 0)` }}
        role="img" aria-label={`Focus ${bounded}%`}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-surface text-[10px] font-semibold">{bounded}</span>
      </span>
      <span><span className="block font-semibold text-teal">{bounded}%</span><span className={`block text-[10px] ${status === "Strong" ? "text-emerald-300" : "text-muted-foreground"}`}>{status}</span></span>
    </div>
  );
};

const ReportsLoading = () => (
  <div className="p-4 sm:p-5" role="status" aria-label="Loading reports">
    <span className="sr-only">Loading Reports...</span>
    <div className="space-y-3 md:hidden">
      {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-lg bg-bg-hover motion-reduce:animate-none" />)}
    </div>
    <div className="hidden space-y-3 md:block">
      {Array.from({ length: 5 }, (_, index) => <div key={index} className="grid grid-cols-6 gap-4 py-3">
        {Array.from({ length: 6 }, (_, cell) => <span key={cell} className="h-5 animate-pulse rounded bg-bg-hover motion-reduce:animate-none" />)}
      </div>)}
    </div>
    <p className="mt-3 text-center text-xs text-muted-foreground">Loading Reports...</p>
  </div>
);

const languageSummary = (reports: AssessmentReport[]) => {
  const counts = new Map<string, number>();
  for (const report of reports) {
    const language = getReportLanguage(report).toLowerCase();
    if (language) counts.set(language, (counts.get(language) || 0) + 1);
  }
  return [...counts.entries()].map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
};

const ReportInsightsVideo = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.readyState) return;
    if (prefersReducedMotion) {
      video.pause();
      return;
    }
    void video.play().then(() => {
      setAutoplayBlocked(false);
    }).catch(() => {
      setAutoplayBlocked(true);
    });
  }, [prefersReducedMotion]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
    } else {
      video.pause();
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[300px] self-center lg:mx-0 lg:justify-self-end">
      <div className="group relative aspect-video w-full overflow-hidden rounded-xl border border-teal/20 bg-black shadow-lg shadow-black/25 transition-colors hover:border-teal/50 hover:shadow-teal/10 focus-within:border-teal/50">
        {!unavailable && (
          <video
            ref={videoRef}
            src="/report.mp4"
            aria-label="AI report insights video"
            autoPlay={!prefersReducedMotion}
            muted
            loop={!prefersReducedMotion}
            playsInline
            controls
            preload="metadata"
            onLoadStart={() => setLoading(true)}
            onLoadedData={() => setLoading(false)}
            onCanPlay={() => {
              setLoading(false);
              if (!prefersReducedMotion && videoRef.current?.paused) {
                void videoRef.current.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
              }
            }}
            onWaiting={() => setLoading(true)}
            onPlaying={() => { setLoading(false); setPlaying(true); setAutoplayBlocked(false); }}
            onPause={() => setPlaying(false)}
            onError={() => { setLoading(false); setUnavailable(true); }}
            className="h-full w-full bg-black object-cover transition-[filter] duration-200 group-hover:brightness-110 motion-reduce:transition-none"
          >
            Your browser does not support embedded videos.
          </video>
        )}
        {loading && !unavailable && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-white/80" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />Loading report insights...
          </div>
        )}
        {!unavailable && (autoplayBlocked || !playing) && !loading && (
          <button type="button" onClick={togglePlayback} aria-label={playing ? "Pause report insights video" : "Play report insights video"}
            className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/55 text-white shadow-lg backdrop-blur-sm transition-all hover:scale-105 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal group-hover:opacity-100 sm:opacity-0">
            {playing ? <CirclePause className="h-8 w-8" /> : <CirclePlay className="h-8 w-8" />}
          </button>
        )}
        {unavailable && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-bg-hover to-background p-4 text-center text-sm text-muted-foreground" role="status">
            Report video unavailable
          </div>
        )}
      </div>
      <p className="mt-2 text-right text-[11px] font-medium tracking-wide text-muted-foreground">AI Report Insights</p>
    </div>
  );
};

const capitalize = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const isToday = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
};

export default Reports;
