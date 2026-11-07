import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { CATEGORY_LABEL, fmtDate, fmtDuration } from "../lib/format";
import type { Audit, Finding, Website } from "../lib/types";
import { FindingsList } from "../components/Findings";
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, ScoreRing, SectionTitle, Select, Spinner, StatusBadge, useToast } from "../components/ui";
import { DeleteWebsite, WebsiteForm } from "./Websites";

export default function WebsiteDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [mode, setMode] = useState<"site" | "url">("site");
  const [pageUrl, setPageUrl] = useState("");
  const [maxPages, setMaxPages] = useState(50);
  const [maxDepth, setMaxDepth] = useState(3);

  const site = useQuery({ queryKey: ["website", id], queryFn: () => api<Website>(`/websites/${id}`) });
  const audits = useQuery({
    queryKey: ["audits", id], queryFn: () => api<Audit[]>(`/websites/${id}/audits`),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "queued" || a.status === "running") ? 2000 : false),
  });
  const latest = audits.data?.find((a) => a.status === "completed" && a.mode === "site") ?? audits.data?.find((a) => a.status === "completed");
  const running = audits.data?.some((a) => a.status === "queued" || a.status === "running");
  const findings = useQuery({ queryKey: ["findings", latest?.id], enabled: !!latest, queryFn: () => api<Finding[]>(`/audits/${latest!.id}/findings`) });

  const start = useMutation({
    mutationFn: () => api<Audit>(`/websites/${id}/audits`, { method: "POST", body: { mode, url: mode === "url" ? pageUrl : undefined, max_pages: maxPages, max_depth: maxDepth } }),
    onSuccess: () => { toast("success", "Audit started"); qc.invalidateQueries({ queryKey: ["audits", id] }); },
    onError: (e: Error) => toast("error", e.message),
  });
  // When a running audit finishes, refresh everything that depends on it.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      for (const key of [["website", id], ["websites"], ["overview"]]) qc.invalidateQueries({ queryKey: key });
    }
    wasRunning.current = !!running;
  }, [running, id, qc]);

  if (site.isLoading) return <Spinner />;
  if (site.error || !site.data) return <ErrorState error={site.error ?? new Error("Website not found")} />;
  const w = site.data;
  const unresolved = (findings.data ?? []).filter((f) => f.severity !== "info");

  return (
    <>
      <PageHeader title={w.name} subtitle={<a className="inline-flex items-center gap-1 hover:text-accent" href={w.url} target="_blank" rel="noopener noreferrer">{w.url}<ExternalLink className="size-3" aria-hidden /></a>}
        actions={<><Button onClick={() => setEdit(true)}><Pencil className="size-4" />Edit</Button><Button variant="ghost" onClick={() => setDel(true)} aria-label="Delete website"><Trash2 className="size-4" /></Button></>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex items-center gap-5">
          <ScoreRing score={w.current_score} size={112} />
          <div className="text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">SEO health</div>
            <div className="mt-1 text-muted">{w.last_audit_at ? `Last full audit ${fmtDate(w.last_audit_at)}` : "No audit yet"}</div>
            <dl className="mt-3 space-y-0.5 text-xs text-muted">
              {w.category && <div>Category: <span className="text-fg">{w.category}</span></div>}
              {w.platform && <div>Platform: <span className="text-fg">{w.platform}</span></div>}
              {w.market && <div>Market: <span className="text-fg">{w.market}</span></div>}
              {w.target_audience && <div>Audience: <span className="text-fg">{w.target_audience}</span></div>}
              <div>Added: <span className="text-fg">{fmtDate(w.created_at)}</span></div>
            </dl>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Run an audit</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Scope">{(i) => <Select id={i} value={mode} onChange={(e) => setMode(e.target.value as "site" | "url")}><option value="site">Entire website</option><option value="url">Single page</option></Select>}</Field>
            {mode === "url" ? (
              <div className="sm:col-span-3"><Field label="Page URL" hint="Must be on this website.">{(i) => <Input id={i} value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder={`${w.url}about`} />}</Field></div>
            ) : (
              <>
                <Field label="Max pages" hint="Up to the server limit.">{(i) => <Input id={i} type="number" min={1} max={200} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value) || 1)} />}</Field>
                <Field label="Max depth" hint="Clicks from home.">{(i) => <Input id={i} type="number" min={0} max={6} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value) || 0)} />}</Field>
                <div className="flex items-end"><p className="text-xs text-muted">Honours robots.txt and crawl-delay. Public pages only.</p></div>
              </>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" busy={start.isPending || !!running} onClick={() => start.mutate()} disabled={mode === "url" && !pageUrl.trim()}><Play className="size-4" />{running ? "Audit running…" : "Start audit"}</Button>
            {running && <span className="text-sm text-muted" role="status">Crawling — results appear automatically.</span>}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>Unresolved issues{latest ? ` · audit #${latest.id}` : ""}</SectionTitle>
        {!latest ? <EmptyState title="Nothing to show yet" body="Run an audit to see issues and recommendations." />
          : findings.isLoading ? <Spinner /> : unresolved.length === 0 ? <EmptyState title="No critical issues or warnings" body="The latest audit found nothing at warning level or above." />
          : <FindingsList findings={unresolved} exportName={`${w.name}-issues`} pageLinks />}
      </div>

      <Card className="mt-6" pad={false}>
        <div className="p-5 pb-2"><SectionTitle>Audit history</SectionTitle></div>
        {!audits.data?.length ? <p className="px-5 pb-5 text-sm text-muted">No audits yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Audit", "Date", "Scope", "Status", "Score", "Pages", "Critical", "Warnings", "Duration"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {audits.data.map((a) => (
                  <tr key={a.id} className="border-t border-line hover:bg-surface2">
                    <td className="px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/audits/${a.id}`}>#{a.id}</Link></td>
                    <td className="px-4 text-muted">{fmtDate(a.created_at, true)}</td><td className="px-4">{a.mode === "site" ? "Whole site" : "Single page"}</td>
                    <td className="px-4"><StatusBadge status={a.status} /></td>
                    <td className="num px-4 font-medium">{a.score ?? "—"}</td><td className="num px-4">{a.pages_crawled}</td>
                    <td className="num px-4 text-danger">{a.critical_count}</td><td className="num px-4 text-warn">{a.warning_count}</td><td className="num px-4 text-muted">{fmtDuration(a.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {latest && <p className="border-t border-line px-5 py-3 text-xs text-muted">Category scores (latest): {Object.entries(latest.category_scores).map(([k, v]) => `${CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]} ${v ?? "n/a"}`).join(" · ")}</p>}
      </Card>

      {edit && <WebsiteForm initial={w} onClose={() => setEdit(false)} />}
      {del && <DeleteWebsite site={w} onClose={() => setDel(false)} onDeleted={() => nav("/websites")} />}
    </>
  );
}
