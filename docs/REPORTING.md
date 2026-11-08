# Calendar, notifications, reports and exports (Phase E)

## Content calendar

- Month, week and list views over `content_entries` (the same rows the AI Content Studio saves). Filter by client and platform; the server filters by date range, so only the visible period is fetched.
- Entry fields: title, content type, platform, status (`idea → draft → in_review → approved → scheduled → published`), publishing date, client, caption/text, and up to 10 **media references** (links or file names; there is no file upload).
- Statuses are for planning. **Nothing is published to any social platform**: that needs an authorised account connection and a platform API, neither of which exists here. The calendar says so on the page.
- Entries without a date appear only in the list view.

## Notifications (in-app only)

The bell in the header refreshes every minute and on open. `GET /api/notifications` first creates any missing notifications from stored data, then returns the newest 50 and the unread count. Each notification has a de-duplication key, so refreshing never repeats one.

| Created when | Key |
|---|---|
| An open task is overdue / due within 2 days | `task:{id}:overdue` / `task:{id}:soon:{date}` |
| A lead's follow-up date has arrived (not converted or lost) | `lead:{id}:followup:{date}` |
| An audit finished or failed in the last 7 days | `audit:{id}:{status}` |
| A proposal passed its valid-until date | `proposal:{id}:expired` |
| Approved/scheduled content is dated today | `content:{id}:{date}` |

Nothing is emailed, texted or pushed. Notifications belong to the organisation, not to one user: reading one marks it read for everyone in the organisation. Notifications are not removed when the underlying item is resolved; they stay until you mark them read.

## Reports

A report is a **saved snapshot** of your stored data for a period (up to one year), generated for a website, a client, or both. Because it is a snapshot, exports never change after the fact.

| Section | Needs | Data source label |
|---|---|---|
| SEO audit | website | **Measured**: Crescova's crawler. Latest full-site audit in the period, category scores, open issues, and, with two or more audits, score change plus resolved and new issue types |
| Keywords | website | Entered or imported by your team. AI-suggested terms are marked and have empty metrics |
| Completed tasks | website or client | Your task records |
| Accepted AI recommendations | website | **AI-generated**, reviewed and accepted by a person. Not measured data |
| Project progress | client | Your client and onboarding records |
| Content | none | Your content records (AI-assisted drafts flagged) |
| Notes | none | Text you wrote |

A section whose scope is missing (for example SEO without a website) is listed under **Not included** with the reason rather than silently dropped. Where a period has no full-site audit the SEO section says so.

Exports: **PDF**, **CSV** (`section, item, value, data_source`: every row carries its source) and **JSON** (the full snapshot). CSV cells that start with `= + - @` are prefixed so spreadsheets don't run them; PDF text is escaped.

### What reports will never contain

Google Analytics 4 and Search Console are **not connected**, so reports contain no sessions, conversions, impressions, clicks or ranking positions, and every report says so. Keyword volume, difficulty, CPC and position appear only if a person entered or imported them, with where they came from.

### Integration points for later

`integrations` in the report data (`google_analytics_4`, `google_search_console`) is where connected-source status will be reported. A real integration would need: a Google OAuth app and consent flow, encrypted token storage per organisation, a sync job writing metrics to new tables with a `source` column, and a new report section reading them. None of that exists yet.

## Data export

Settings → Data export downloads `leads`, `clients`, `proposals` (with computed totals), `tasks`, `keywords` and `content` as CSV, scoped to your organisation. Audits are exported from their own pages.
