export type Severity = "critical" | "warning" | "info";
export type CategoryKey = "technical" | "onpage" | "content" | "indexability" | "linking" | "structured";

export interface User { id: number; email: string; full_name: string; role: string; organisation_id: number; organisation_name: string }

export interface Website {
  id: number; name: string; url: string; category: string; target_audience: string; market: string;
  platform: string; description: string; created_at: string; last_audit_at: string | null; current_score: number | null;
}

export interface Audit {
  id: number; website_id: number; status: "queued" | "running" | "completed" | "failed"; mode: "site" | "url";
  target_url: string; max_pages: number; max_depth: number; created_at: string; finished_at: string | null;
  duration_ms: number | null; pages_crawled: number; score: number | null;
  category_scores: Partial<Record<CategoryKey, number | null>>;
  critical_count: number; warning_count: number; info_count: number; passed_count: number; error: string | null;
  website_name?: string;
}
export interface AuditDetail extends Audit {
  weights: Record<string, number>;
  summary: { truncated?: boolean; robots?: { present: boolean }; sitemap?: { found: boolean; url_count: number }; external_links_checked?: number; images_checked?: number; skipped_by_robots?: string[] };
}

export interface Finding {
  id: number; page_id: number | null; check_id: string; name: string; severity: Severity; category: CategoryKey;
  url: string; explanation: string; why_it_matters: string; recommendation: string; evidence: string;
}

export interface PageRow { id: number; url: string; final_url: string; status_code: number | null; depth: number; title: string; word_count: number; indexable: boolean; score: number | null; response_ms: number | null }
export interface PageDetail extends PageRow {
  audit_id: number; meta_description: string; canonical: string; error: string | null; findings: Finding[];
  data: {
    h1s: string[]; headings: [number, string][]; images: { src: string; alt: string | null }[]; internal_links: string[]; external_links: string[];
    schema_types: string[]; schema_issues: string[]; og: Record<string, string>; twitter: Record<string, string>; redirects: { url: string; status: number }[];
    robots_meta: string; lang: string; viewport: string;
  };
}

export interface Overview {
  seo: { websites: number; audits_total: number; average_score: number | null; critical_issues: number; warnings: number; improvements_completed: number };
  score_trend: { date: string; score: number; website: string }[];
  audit_activity: { date: string; audits: number }[];
  recent_audits: (Audit & { website_name: string })[];
  business: null;
}

export interface Comparison {
  base_id: number; target_id: number; score_delta: number | null; category_deltas: Partial<Record<CategoryKey, number | null>>;
  new: Finding[]; resolved: Finding[]; persistent: Finding[];
}

export interface CheckCatalogue {
  categories: Record<CategoryKey, string>;
  checks: { id: string; name: string; category: CategoryKey; severity: Severity; explanation: string; why: string; fix: string }[];
  severity_weights: Record<Severity, number>;
}

export interface SystemStatus {
  environment: string; database: string; ai_provider: string; ai_keys_configured: Record<string, boolean>;
  category_weights: Record<string, number>; crawl_limits: { max_pages: number; max_depth: number; delay_seconds: number };
  registration_open: boolean; integrations: Record<string, string>;
}
