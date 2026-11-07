import type { CategoryKey, Severity } from "./types";

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  technical: "Technical SEO", onpage: "On-page SEO", content: "Content & metadata",
  indexability: "Indexability", linking: "Internal linking", structured: "Structured data",
};

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Opportunity" };

export function scoreTone(score: number | null | undefined): "ok" | "warn" | "danger" | "muted" {
  if (score == null) return "muted";
  return score >= 80 ? "ok" : score >= 60 ? "warn" : "danger";
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function pathOf(url: string): string {
  try { const u = new URL(url); return u.pathname + u.search || "/"; } catch { return url; }
}

/** Quote a CSV cell and neutralise spreadsheet formulas in site-supplied text. */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
