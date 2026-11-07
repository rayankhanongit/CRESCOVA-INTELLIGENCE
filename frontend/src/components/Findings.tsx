import { ChevronDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABEL, SEVERITY_LABEL, csvCell, pathOf } from "../lib/format";
import type { CategoryKey, Finding, Severity } from "../lib/types";
import { Badge, Button, EmptyState, Select, SeverityBadge } from "./ui";

export function downloadFindingsCsv(findings: Finding[], filename: string) {
  const head = ["severity", "category", "issue", "url", "explanation", "why_it_matters", "recommendation", "evidence"];
  const rows = findings.map((f) => [f.severity, f.category, f.name, f.url, f.explanation, f.why_it_matters, f.recommendation, f.evidence].map(csvCell).join(","));
  const url = URL.createObjectURL(new Blob([[head.join(","), ...rows].join("\r\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function FindingRow({ f, pageLinks }: { f: Finding; pageLinks?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-line first:border-t-0">
      <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface2" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SeverityBadge severity={f.severity} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{f.name}</div>
          <div className="truncate text-xs text-muted" title={f.url}>{pathOf(f.url)}</div>
        </div>
        <Badge>{CATEGORY_LABEL[f.category]}</Badge>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-3 bg-surface2 px-4 py-4 text-sm md:grid-cols-2">
          <Block title="What was detected" tag="Deterministic finding">{f.explanation}</Block>
          <Block title="Why it matters">{f.why_it_matters}</Block>
          <Block title="Recommended fix">{f.recommendation}</Block>
          <Block title="Detection evidence">{f.evidence ? <code className="break-words font-mono text-xs">{f.evidence}</code> : <span className="text-muted">Detected from the page/site structure itself.</span>}</Block>
          <div className="md:col-span-2 text-xs text-muted">
            URL: <span className="break-all font-mono">{f.url}</span>
            {pageLinks && f.page_id && <> · <Link className="text-accent hover:underline" to={`/pages/${f.page_id}`}>Open page analysis</Link></>}
          </div>
        </div>
      )}
    </li>
  );
}

function Block({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}{tag && <Badge tone="accent">{tag}</Badge>}</div>
      <div>{children}</div>
    </div>
  );
}

export function FindingsList({ findings, exportName, pageLinks }: { findings: Finding[]; exportName: string; pageLinks?: boolean }) {
  const [sev, setSev] = useState<"" | Severity>("");
  const [cat, setCat] = useState<"" | CategoryKey>("");
  const shown = useMemo(() => findings.filter((f) => (!sev || f.severity === sev) && (!cat || f.category === cat)), [findings, sev, cat]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by severity" className="!w-auto" value={sev} onChange={(e) => setSev(e.target.value as Severity | "")}>
          <option value="">All severities</option>
          {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Filter by category" className="!w-auto" value={cat} onChange={(e) => setCat(e.target.value as CategoryKey | "")}>
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
        <span className="num text-sm text-muted">{shown.length} of {findings.length}</span>
        <Button size="sm" className="ml-auto" disabled={!shown.length} onClick={() => downloadFindingsCsv(shown, `${exportName}.csv`)}><Download className="size-3.5" />Export CSV</Button>
      </div>
      {shown.length === 0 ? (
        <EmptyState title={findings.length ? "No findings match these filters" : "No issues detected"} body={findings.length ? undefined : "All applicable checks passed."} />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-surface">{shown.map((f) => <FindingRow key={f.id} f={f} pageLinks={pageLinks} />)}</ul>
      )}
    </div>
  );
}
