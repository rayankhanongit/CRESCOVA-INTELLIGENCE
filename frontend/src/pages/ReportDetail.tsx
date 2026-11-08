import { useQuery } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AiBadge } from "../components/Ai";
import { Badge, Button, Card, Confirm, ErrorState, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAction } from "../lib/crm";
import { CATEGORY_LABEL, fmtDate } from "../lib/format";
import type { CategoryKey, ReportDetailData } from "../lib/types";
import { SECTIONS } from "./Reports";

/** Says where a section's numbers came from so measured data is never confused with typed-in or AI text. */
function Provenance({ name, source }: { name: string; source: string }) {
  const badge = name === "seo" ? <Badge tone="ok">Measured by Crescova</Badge> : name === "recommendations" ? <AiBadge label="AI-generated, reviewed" /> : <Badge tone="info">Entered by your team</Badge>;
  return <div className="mb-3 flex flex-wrap items-center gap-2">{badge}<span className="text-xs text-muted">{source}</span></div>;
}
const na = (v: unknown) => (v == null || v === "" ? "n/a" : String(v));

export default function ReportDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: ["report", id], queryFn: () => api<ReportDetailData>(`/reports/${id}`) });
  const remove = useAction(() => api(`/reports/${id}`, { method: "DELETE" }), { invalidate: ["reports"], ok: "Report deleted", done: () => nav("/reports") });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Report not found")} />;
  const r = q.data, s = r.data.sections, m = r.data.meta;

  return (
    <>
      <Link to="/reports" className="mb-3 inline-block text-sm text-muted hover:text-accent">Back to reports</Link>
      <PageHeader title={r.title} subtitle={<>{fmtDate(r.period_start)} to {fmtDate(r.period_end)}{m.website && ` · ${m.website.name}`}{m.client && ` · ${m.client.name}`} · generated {fmtDate(m.generated_at, true)}</>}
        actions={<>{(["pdf", "csv", "json"] as const).map((f) => <a key={f} href={`/api/reports/${id}/export.${f}`} download><Button size="sm"><Download className="size-3.5" />{f.toUpperCase()}</Button></a>)}
          <Button size="sm" variant="ghost" aria-label="Delete report" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button></>} />
      <p className="mb-4 rounded-2xl bg-surface2 p-3 text-sm text-muted">This is a saved snapshot. Google Analytics and Search Console are <strong>not connected</strong>, so there are no traffic, impression, click or ranking-position figures here.</p>

      <div className="space-y-4">
        {s.seo && (
          <Card><SectionTitle>{SECTIONS[0].label}</SectionTitle><Provenance name="seo" source={s.seo.source} />
            {s.seo.note ? <p className="text-sm text-muted">{s.seo.note}</p> : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                  <span className="font-display text-3xl font-semibold">{s.seo.score}<span className="text-base text-muted"> / 100</span></span>
                  {s.seo.score_change != null && <span className={s.seo.score_change >= 0 ? "text-ok" : "text-danger"}>{s.seo.score_change > 0 ? "+" : ""}{s.seo.score_change} since {fmtDate(s.seo.first_audit_date)}</span>}
                  <span>{s.seo.pages_crawled} pages · {s.seo.critical} critical · {s.seo.warnings} warnings · {s.seo.checks_passed} passed</span>
                </div>
                <p className="mt-1 text-xs text-muted">Crescova's own diagnostic score, not a Google ranking factor. Based on the audit of {fmtDate(s.seo.latest_audit_date)}.</p>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-3">{Object.entries(s.seo.category_scores as Record<string, number | null>).map(([k, v]) => <div key={k} className="flex justify-between rounded-lg bg-surface2 px-3 py-1.5 text-sm"><span>{CATEGORY_LABEL[k as CategoryKey] ?? k}</span><span className="num">{na(v)}</span></div>)}</div>
                {s.seo.resolved && <p className="mt-3 text-sm"><strong>{s.seo.resolved.length}</strong> issue types resolved and <strong>{s.seo.new.length}</strong> new since the first audit in this period.</p>}
                {s.seo.open_issues.length > 0 && <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">Open issue</th><th className="font-medium">Severity</th><th className="font-medium">URLs</th></tr></thead>
                  <tbody>{s.seo.open_issues.map((i: any) => <tr key={i.issue + i.severity} className="border-t border-line"><td className="py-1.5">{i.issue}</td><td>{i.severity}</td><td className="num">{i.affected_urls}</td></tr>)}</tbody></table>}
              </>)}
          </Card>)}
        {s.keywords && (
          <Card><SectionTitle>{SECTIONS[1].label}</SectionTitle><Provenance name="keywords" source={s.keywords.source} />
            {!s.keywords.items.length ? <p className="text-sm text-muted">No keywords recorded.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr>{["Keyword", "Intent", "Volume", "Position", "Source of numbers"].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>{s.keywords.items.map((k: any) => <tr key={k.term} className="border-t border-line"><td className="py-1.5 pr-3">{k.term}</td><td className="pr-3">{k.intent}</td><td className="num pr-3">{na(k.search_volume)}</td><td className="num pr-3">{na(k.position)}</td><td>{k.metrics_source || (k.origin === "ai_estimate" ? "AI idea (no metrics)" : "n/a")}</td></tr>)}</tbody></table></div>)}
          </Card>)}
        {s.tasks && (
          <Card><SectionTitle>{SECTIONS[2].label}</SectionTitle><Provenance name="tasks" source={s.tasks.source} />
            <p className="text-sm">{s.tasks.completed_in_period.length} completed in this period · {s.tasks.open} open · {s.tasks.overdue} overdue</p>
            <ul className="mt-2 list-disc pl-5 text-sm">{s.tasks.completed_in_period.map((t: any, i: number) => <li key={i}>{t.title} <span className="text-muted">({fmtDate(t.completed)})</span></li>)}</ul>
          </Card>)}
        {s.recommendations && (
          <Card><SectionTitle>{SECTIONS[3].label}</SectionTitle><Provenance name="recommendations" source={s.recommendations.source} />
            {!s.recommendations.items.length ? <p className="text-sm text-muted">No accepted recommendations in this period.</p> : <ul className="space-y-2 text-sm">{s.recommendations.items.map((x: any, i: number) => <li key={i}><strong>{x.issue}:</strong> {x.recommendation}</li>)}</ul>}
          </Card>)}
        {s.progress && (
          <Card><SectionTitle>{SECTIONS[4].label}</SectionTitle><Provenance name="progress" source={s.progress.source} />
            <p className="text-sm">Client status: {s.progress.client_status}. Onboarding {s.progress.onboarding_done} of {s.progress.onboarding_total} items done.</p>
          </Card>)}
        {s.content && (
          <Card><SectionTitle>{SECTIONS[5].label}</SectionTitle><Provenance name="content" source={s.content.source} />
            {!s.content.items.length ? <p className="text-sm text-muted">No content dated in this period.</p> : <ul className="space-y-1 text-sm">{s.content.items.map((e: any, i: number) => <li key={i}>{fmtDate(e.date)} · {e.title} <span className="text-muted">({e.platform || "n/a"}, {e.status}{e.ai_assisted ? ", AI-assisted" : ""})</span></li>)}</ul>}
          </Card>)}
        {s.notes && <Card><SectionTitle>{SECTIONS[6].label}</SectionTitle><Provenance name="notes" source={s.notes.source} /><p className="whitespace-pre-wrap text-sm">{s.notes.text}</p></Card>}
        {r.data.skipped.length > 0 && <Card><SectionTitle>Not included</SectionTitle><ul className="list-disc pl-5 text-sm text-muted">{r.data.skipped.map((x) => <li key={x}>{x}</li>)}</ul></Card>}
      </div>
      {del && <Confirm title="Delete this report?" confirmLabel="Delete report" busy={remove.isPending} onCancel={() => setDel(false)} onConfirm={() => remove.mutate()} body="The saved snapshot and its exports are permanently deleted. Your underlying data is not affected." />}
    </>
  );
}
