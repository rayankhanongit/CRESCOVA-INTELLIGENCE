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

## Phase D tables (migration `0002_phase_d_agency_management.py`)

`organisations` gains `currency` (3-letter code, default `USD`): one currency per agency, so sums are always meaningful.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `pricing_packages` | The agency's own price list | `organisation_id`, `name`, `price`, `billing` (one_time/monthly), `is_active` |
| `leads` | Prospects | `organisation_id`, contact fields, `budget`, `source`, `status`, `priority` (set by a person), `qualification` (JSON), `last_contacted_at`, `next_follow_up`; index (`organisation_id`, `status`) |
| `clients` | Customers | `organisation_id`, `source_lead_id → leads` (SET NULL), contract dates, `monthly_value`, `status` |
| `activities` | Timeline for leads and clients | `lead_id → leads` (CASCADE, nullable), `client_id → clients` (CASCADE, nullable), `user_id` (SET NULL), `kind`, `text` |
| `proposals` | Quotes | `lead_id`, `client_id` (both SET NULL), `recipient_name` snapshot, terms text, `discount_percent`, `status`, `valid_until`, `sent_at` |
| `proposal_items` | Quote lines | `proposal_id` (CASCADE), `package_id` (SET NULL), `description`, `quantity`, `unit_price`, `position` |
| `onboarding_tasks` | Client checklist | `client_id` (CASCADE), `title`, `done`, `done_at`, `position` |
| `tasks` | Work items and reminders | `assignee_id` (SET NULL), `website_id` (SET NULL), `client_id` (SET NULL), `due_date`, `priority`, `completed_at` |

Design choices: `activities` is one table for both leads and clients instead of a separate `lead_activities`; totals are not stored (they are computed from the lines, so they can't drift); money is `NUMERIC(12,2)` read back as a float rounded to 2 decimals (switch to `Decimal` before adding invoicing); proposal lines copy description and price so they survive package edits or deletion.

## Phase C tables (migration `0003_phase_c_ai_modules.py`)

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `seo_recommendations` | AI advice about one check in one audit | `audit_id` (CASCADE), `check_id`, `interpretation`, `recommendation`, `example`, `status` (suggested/accepted/dismissed), `provider`, `model` |
| `keywords` | Keyword workspace | `website_id` (CASCADE, nullable), `term`, `intent`, `topic`, `mapped_url`, `source` (manual/ai_estimate/imported), `search_volume`, `difficulty`, `cpc`, `position` (**only ever entered or imported by a person**), `metrics_source` |
| `competitors` | Competitor sites per website | `website_id` (CASCADE), unique (`website_id`, `url`), `status`, `analysis` (JSON of counted facts), `insights` (JSON, AI-labelled), `error` |
| `content_entries` | Content drafts (the Phase E calendar will schedule these rows) | `client_id` (SET NULL), `kind`, `platform`, `body`, `params` (JSON brief), `ai_generated`, `status`, `publish_date` |
| `ai_usage_logs` | One row per AI call | `purpose`, `provider`, `model`, `tokens_in/out` (when reported), `ok` |

Deviation from the original entity list: there is no `keyword_groups` table; a keyword's `topic` string is its group, which is all the UI needs.

Not yet created (later phases): client_projects, reports, notifications.
