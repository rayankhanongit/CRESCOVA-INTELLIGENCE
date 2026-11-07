# Database schema (Phases A–B)

Migration: `backend/alembic/versions/0001_phase_a_b_foundation.py`. Timestamps are timezone-aware UTC.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `organisations` | Tenant (agency) | `id`, `name` |
| `users` | Accounts | `organisation_id → organisations` (CASCADE), unique indexed `email`, `password_hash`, `role`, `is_active` |
| `websites` | Managed sites | `organisation_id` (CASCADE, indexed), `url`, profile fields, denormalised `current_score`, `last_audit_at`; **unique (`organisation_id`, `url`)** |
| `seo_audits` | One crawl run | `organisation_id`, `website_id → websites` (CASCADE), `status`, `mode` (site/url), limits, `score`, `category_scores` (JSON), `weights` (JSON, the weights used), counts, `summary` (JSON), `duration_ms`; index (`website_id`, `created_at`) |
| `website_pages` | Pages seen in an audit | `audit_id` (CASCADE, indexed), `url`, `final_url`, `status_code`, headline SEO fields, `score`, `data` (JSON: headings, images, links, schema, social tags) |
| `seo_findings` | Failed checks | `audit_id` (CASCADE), `page_id → website_pages` (CASCADE, nullable for site-wide findings), `check_id`, `severity`, `category`, explanation/why/fix/evidence, `fingerprint` (`check_id|url`, indexed) |
| `audit_logs` | Security/audit trail | `organisation_id` (CASCADE), `user_id` (SET NULL), `action`, `detail`, `ip` |

Deletion: deleting an organisation removes everything it owns; deleting a website removes its audits, pages and findings; deleting an audit removes its pages and findings. SQLite foreign keys are enabled explicitly (`PRAGMA foreign_keys=ON`).

Why JSON columns: per-page headings/links/images and per-audit summaries are read whole and never queried by field, so normalising them would add joins without benefit. Everything filterable (status, severity, category, score, fingerprint) is a real column.

Not yet created (later phases): keywords, keyword_groups, competitors, leads, lead_activities, clients, client_projects, proposals, proposal_items, pricing_packages, onboarding_tasks, content_entries, tasks, reports, notifications, ai_usage_logs, seo_recommendations.
