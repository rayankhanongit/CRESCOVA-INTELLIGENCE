import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { CATEGORY_LABEL, fmtDate, fmtDuration, hostOf, pathOf, scoreTone } from "../lib/format";
import type { AuditDetail, CategoryKey, CheckCatalogue, Finding, PageRow } from "../lib/types";
import { FindingsList } from "../components/Findings";
import Recommendations from "../components/Recommendations";
import { Badge, Button, Card, Confirm, ErrorState, PageHeader, ScoreRing, SectionTitle, Spinner, Stat, StatusBadge, useToast } from "../components/ui";

export function ScoreExplainer({ audit }: { audit: AuditDetail }) {
  const cat = useQuery({ queryKey: ["check-catalogue"], queryFn: () => api<CheckCatalogue>("/meta/checks"), staleTime: Infinity });
  return (
    <Card>
      <SectionTitle>How this score is calculated</SectionTitle>
      <p className="mb-4 text-sm text-muted">
        The SEO Health Score is Crescova's own diagnostic metric. It is built only from the deterministic checks below and is <strong>not a Google ranking factor</strong>.
        Each check's pass rate is weighted by severity (critical 3, warning 2, opportunity 1) into a category score; categories are then combined using the weights shown.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 font-medium">Category</th><th className="font-medium">Weight</th><th className="font-medium">Score</th><th className="font-medium">Checks</th></tr></thead>
          <tbody>
            {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((c) => {
              const s = audit.category_scores[c];
              const n = cat.data?.checks.filter((k) => k.category === c).map((k) => k.name) ?? [];
              return (
                <tr key={c} className="border-t border-line align-top">
                  <td className="py-2.5 font-medium">{CATEGORY_LABEL[c]}</td>
                  <td className="num">{audit.weights[c] ?? 0}%</td>
                  <td className="py-2.5"><div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${s ?? 0}%`, background: `var(--${scoreTone(s) === "muted" ? "line" : scoreTone(s)})` }} /></div><span className="num">{s ?? "n/a"}</span></div></td>
                  <td className="pr-2 text-xs text-muted">{n.join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">A category with no applicable checks (shown n/a) is left out and the remaining weights are re-balanced. Weights are configurable by the administrator.</p>
    </Card>
  );
}

export default function AuditDetailPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const audit = useQuery({
    queryKey: ["audit", id], queryFn: () => api<AuditDetail>(`/audits/${id}`),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 2000 : false),
  });
  const done = audit.data?.status === "completed";
  const findings = useQuery({ queryKey: ["findings", id], enabled: done, queryFn: () => api<Finding[]>(`/audits/${id}/findings`) });
  const pages = useQuery({ queryKey: ["pages", id], enabled: done, queryFn: () => api<PageRow[]>(`/audits/${id}/pages`) });
  const del = useMutation({
    mutationFn: () => api(`/audits/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries(); toast("success", "Audit deleted"); nav(`/websites/${audit.data!.website_id}`); },
    onError: (e: Error) => toast("error", e.message),
  });

  if (audit.isLoading) return <Spinner />;
  if (audit.error || !audit.data) return <ErrorState error={audit.error ?? new Error("Audit not found")} />;
  const a = audit.data;

  return (
    <>
      <PageHeader title={`Audit #${a.id}`} subtitle={<>{hostOf(a.target_url)} · {a.mode === "site" ? "whole site" : "single page"} · {fmtDate(a.created_at, true)}</>}
        actions={<>
          {done && (["csv", "json", "pdf"] as const).map((f) => <a key={f} href={`/api/audits/${id}/export.${f}`} download><Button size="sm"><Download className="size-3.5" />{f.toUpperCase()}</Button></a>)}
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete audit"><Trash2 className="size-4" /></Button>
        </>} />

      {(a.status === "queued" || a.status === "running") && (
        <Card className="mb-4"><div className="flex items-center gap-3"><StatusBadge status={a.status} /><span className="text-sm text-muted" role="status">Crawl in progress — this page updates automatically.</span></div></Card>
      )}
      {a.status === "failed" && <div className="mb-4"><ErrorState error={new Error(a.error ?? "The audit failed.")} /></div>}

      {done && (
        <>
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <Card className="flex items-center justify-center md:px-10"><div className="flex flex-col items-center gap-2"><ScoreRing score={a.score} size={132} /><div className="text-xs font-medium uppercase tracking-wide text-muted">SEO health score</div></div></Card>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Stat label="Critical" value={a.critical_count} tone={a.critical_count ? "danger" : "ok"} />
              <Stat label="Warnings" value={a.warning_count} tone={a.warning_count ? "warn" : "ok"} />
              <Stat label="Opportunities" value={a.info_count} />
              <Stat label="Checks passed" value={a.passed_count} tone="ok" />
              <Stat label="Pages crawled" value={a.pages_crawled} hint={a.summary.truncated ? "Stopped at the page limit" : undefined} />
              <Stat label="Duration" value={fmtDuration(a.duration_ms)} />
              <Stat label="Sitemap" value={a.summary.sitemap?.found ? `${a.summary.sitemap.url_count} URLs` : "None"} />
              <Stat label="robots.txt" value={a.summary.robots?.present ? "Found" : "None"} />
            </div>
          </div>

          <div className="mt-6"><SectionTitle>Findings <Badge tone="accent">Deterministic</Badge></SectionTitle>
            {findings.isLoading ? <Spinner /> : <FindingsList findings={findings.data ?? []} exportName={`audit-${id}-findings`} pageLinks />}
          </div>

          <div className="mt-6"><Recommendations auditId={id} /></div>
          <div className="mt-6"><ScoreExplainer audit={a} /></div>

          <Card className="mt-6" pad={false}>
            <div className="p-5 pb-2"><SectionTitle>Pages crawled</SectionTitle></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr>{["Page", "Status", "Title", "Words", "Indexable", "Score"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {(pages.data ?? []).map((p) => (
                    <tr key={p.id} className="border-t border-line hover:bg-surface2">
                      <td className="max-w-xs truncate px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/pages/${p.id}`} title={p.url}>{pathOf(p.url)}</Link></td>
                      <td className="px-4"><Badge tone={p.status_code && p.status_code < 400 ? "ok" : "danger"}>{p.status_code ?? "error"}</Badge></td>
                      <td className="max-w-xs truncate px-4 text-muted">{p.title || "—"}</td>
                      <td className="num px-4">{p.word_count}</td><td className="px-4">{p.indexable ? "Yes" : "No"}</td><td className="num px-4 font-medium">{p.score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {confirm && <Confirm title="Delete this audit?" confirmLabel="Delete audit" busy={del.isPending} onCancel={() => setConfirm(false)} onConfirm={() => del.mutate()} body="Its findings and page data will be permanently removed and the history chart will change." />}
    </>
  );
}
