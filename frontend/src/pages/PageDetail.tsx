import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiBadge, useAi } from "../components/Ai";
import { useAction } from "../lib/crm";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { pathOf } from "../lib/format";
import type { PageDetail } from "../lib/types";
import { FindingsList } from "../components/Findings";
import { Badge, Button, Card, ErrorState, PageHeader, ScoreRing, SectionTitle, Spinner, Stat } from "../components/ui";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid gap-1 border-t border-line py-2.5 text-sm first:border-t-0 sm:grid-cols-[160px_1fr]"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>
);

interface Rewrite { title: string; meta_description: string; reasoning: string; provider: string; model: string }

function PageRewrite({ pageId }: { pageId: number }) {
  const ai = useAi();
  const [r, setR] = useState<Rewrite | null>(null);
  const run = useAction(() => api<Rewrite>(`/pages/${pageId}/ai-rewrite`, { method: "POST" }), { invalidate: ["usage"], done: setR });
  return (
    <Card className="mt-4">
      <SectionTitle aside={<AiBadge />}>Suggested title and description</SectionTitle>
      <p className="mb-3 text-sm text-muted">A suggestion to review. Copy what you like into your site yourself; nothing is changed or saved here.</p>
      <Button busy={run.isPending} disabled={!ai.configured} title={ai.configured ? undefined : "AI is not configured"} onClick={() => run.mutate()}><Sparkles className="size-4" />Suggest rewrites</Button>
      {!ai.configured && !ai.loading && <span className="ml-3 text-xs text-muted">AI is not configured.</span>}
      {r && (
        <dl className="mt-4 space-y-2 text-sm">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Title <span className="num normal-case">({r.title.length} chars)</span></dt><dd>{r.title}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Meta description <span className="num normal-case">({r.meta_description.length} chars)</span></dt><dd>{r.meta_description}</dd></div>
          {r.reasoning && <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Why</dt><dd className="text-muted">{r.reasoning}</dd></div>}
        </dl>
      )}
    </Card>
  );
}

export default function PageDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ["page", id], queryFn: () => api<PageDetail>(`/pages/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Page not found")} />;
  const p = q.data, d = p.data;
  const missingAlt = d.images.filter((i) => i.alt === null);
  const none = <span className="text-muted">Not set</span>;

  return (
    <>
      <Link to={`/audits/${p.audit_id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="size-4" />Back to audit #{p.audit_id}</Link>
      <PageHeader title={pathOf(p.url)} subtitle={<span className="break-all">{p.url}</span>} />

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Card className="flex items-center justify-center lg:px-10"><div className="flex flex-col items-center gap-2"><ScoreRing score={p.score} size={112} /><span className="text-xs font-medium uppercase tracking-wide text-muted">Page score</span></div></Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="HTTP status" value={p.status_code ?? "—"} tone={p.status_code && p.status_code < 400 ? "ok" : "danger"} />
          <Stat label="Word count" value={p.word_count} />
          <Stat label="Internal links" value={d.internal_links.length} />
          <Stat label="External links" value={d.external_links.length} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>On-page data</SectionTitle>
          <dl>
            <Row k="SEO title">{p.title ? <>{p.title} <span className="num text-xs text-muted">({p.title.length} chars)</span></> : none}</Row>
            <Row k="Meta description">{p.meta_description ? <>{p.meta_description} <span className="num text-xs text-muted">({p.meta_description.length} chars)</span></> : none}</Row>
            <Row k="Canonical URL">{p.canonical || none}</Row>
            <Row k="H1">{d.h1s.length ? d.h1s.join(" | ") : none}</Row>
            <Row k="Indexability">{p.indexable ? <Badge tone="ok">Indexable</Badge> : <Badge tone="warn">Not indexable</Badge>}{d.robots_meta && <span className="ml-2 text-xs text-muted">robots: {d.robots_meta}</span>}</Row>
            <Row k="Language / viewport">{d.lang || "no lang"} · {d.viewport ? "viewport set" : "no viewport"}</Row>
            <Row k="Structured data">{d.schema_types.length ? d.schema_types.map((t) => <Badge key={t} tone="info">{t}</Badge>) : none}{d.schema_issues.map((s) => <div key={s} className="mt-1 text-xs text-warn">{s}</div>)}</Row>
            <Row k="Response time">{p.response_ms != null ? `${p.response_ms} ms` : "—"}</Row>
            {d.redirects.length > 0 && <Row k="Redirects">{d.redirects.map((r) => `${r.status} → ${r.url}`).join("  →  ")} → {p.final_url}</Row>}
          </dl>
        </Card>

        <Card>
          <SectionTitle>Heading structure</SectionTitle>
          {d.headings.length ? (
            <ul className="space-y-1 text-sm">{d.headings.map(([lvl, text], i) => <li key={i} style={{ paddingLeft: (lvl - 1) * 16 }}><span className="mr-2 rounded bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-muted">H{lvl}</span>{text || <em className="text-muted">empty</em>}</li>)}</ul>
          ) : <p className="text-sm text-muted">No headings found.</p>}
          <SectionTitle>{`Images (${d.images.length})`}</SectionTitle>
          <p className="text-sm">{missingAlt.length ? <span className="text-warn">{missingAlt.length} without alt text</span> : <span className="text-ok">All images have alt attributes</span>}</p>
          {missingAlt.slice(0, 6).map((i) => <div key={i.src} className="mt-1 truncate font-mono text-xs text-muted" title={i.src}>{i.src}</div>)}
        </Card>
      </div>

      <PageRewrite pageId={id} />

      <div className="mt-6">
        <SectionTitle>Findings for this page <Badge tone="accent">Deterministic</Badge></SectionTitle>
        <FindingsList findings={p.findings} exportName={`page-${id}-findings`} />
      </div>
    </>
  );
}
