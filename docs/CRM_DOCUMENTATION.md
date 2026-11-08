# CRM, clients, proposals, onboarding and tasks (Phase D)

Everything here is plain stored data. Nothing is sent to anyone: no email, WhatsApp or other messages, and no AI is called.

## Leads

- Pipeline stages: `new → contacted → qualified → proposal_sent → negotiation → converted`, plus `lost`.
- Moving a lead (drag on the board, the status menu on a card, or the detail page) is a `PATCH` and is written to the timeline as a status change. `converted` cannot be set by hand: use **Convert to client**.
- Timeline kinds: `note`, `call`, `email`, `meeting` (added by you), `status_change` and `qualification` (added by the system). Logging a call, email or meeting updates **last contacted**.
- Search matches name, email, company, phone and service interest (wildcard characters in the query are escaped). Filters: status, source, priority. Lists are capped at 500 rows.
- A lead's website is stored as text and shown as a link only if it is `http(s)`; it is **never fetched**. Other schemes (for example `javascript:`) are rejected.

## Qualification (rules-based)

`POST /api/leads/{id}/qualify` runs `backend/app/crm/qualify.py`, a transparent checklist. It reads the lead and your active pricing packages:

| Signal | Points |
|---|---:|
| Has an email or phone | +1 |
| Has a website | +1 |
| Budget provided | +1 |
| Budget ≥ your cheapest priced package | +2 (below it: −1) |
| Interest/notes share a keyword with a package name or description | +1 |
| Notes suggest urgency (quote, asap, this month…) | +2 (low-urgency phrases: −1) |

Score ≥ 5 suggests **high**, ≥ 3 **medium**, otherwise **low**. The result also lists matching packages, a suggested next action, and questions to ask. Every signal is shown in the UI.

It is a suggestion only: it never changes status, never rejects a lead, and never overwrites the priority a person set ("Use suggestion" is a button). It is labelled *Rules-based assessment, not AI*. When the AI provider layer exists (Phase C), an AI variant should store the same JSON shape with `source: "ai"`.

Limits: keyword matching is literal (no synonyms), budget fit only works if packages have prices, and the urgency phrases are English.

## Clients and onboarding

- Convert is explicit and one-way per lead (a second attempt returns 409). It copies contact details, services (from "service interested in") and notes, starts the client in `onboarding`, and links `source_lead_id`. The lead keeps its own timeline; the client's **History** shows both timelines.
- Statuses: `onboarding`, `active`, `paused`, `completed`, `cancelled`. Contract end cannot precede contract start.
- **Start onboarding** creates the standard nine-item checklist (once). You can add, rename, tick and delete items afterwards. The access item reminds you to use invitations or a password manager, never to collect passwords in forms, email or chat.
- Not built: a separate `client_projects` entity. Services purchased is free text.

## Proposals

- A proposal needs a lead or a client (the recipient's name is copied onto the proposal so deleting the lead or client doesn't lose it).
- Lines can come from a pricing package (the description and price are copied, so later package changes or deletion don't alter an existing proposal) or be custom. Money is rounded to 2 decimals per line; the **server's totals are authoritative**, the editor only previews them.
- Statuses are recorded by a person: `draft`, `sent`, `accepted`, `rejected`, `expired`. Marking **sent** requires at least one line, records the time, and moves a lead in `new/contacted/qualified` to `proposal_sent`. A draft or sent proposal past its **valid until** date becomes `expired` the next time it is read.
- Only drafts can be edited (409 otherwise). Set a proposal back to draft deliberately to change it.
- **Download PDF** is generated from stored data with all text escaped. The footer states it is a proposal, not an invoice.
- **Start client onboarding** appears on an accepted proposal that has a client. If it only has a lead, convert the lead first.
- Not built: tax lines, numbering, e-signature, emailing, invoices, payment tracking.

## Pricing and currency

Packages (name, description, price, one-time or monthly, active) live in **Settings** and start empty. The agency has **one currency** (default USD, changeable by the owner). Changing it relabels existing amounts; it does not convert them.

## Tasks and reminders

Tasks have a due date, priority, assignee, optional website and client, notes and a completion time. Overdue and due-within-two-days tasks (and leads whose follow-up date has arrived) appear as in-app reminders on the Tasks page and in the Overview's *Needs attention* list. Dates are plain calendar dates; the server compares against the UTC date and the browser against its local date, so a reminder can differ by a day near midnight.

## Dashboard figures

All computed from stored rows: lead counts by stage, conversion rate (converted ÷ all leads), active clients, proposals sent (ever marked sent) and accepted, **monthly recurring value** (sum of active clients' monthly value) and **accepted proposal value** (totals after discount). There is no revenue-over-time chart or outstanding-payments figure because payments are not tracked.

## Data isolation

Every table carries `organisation_id`. Another organisation's record is always a 404, and any id you submit as a reference (lead, client, website, package, assignee) is checked against your organisation before it is stored. Covered by `test_crm_data_is_isolated_between_organisations`.

## Audit log

Deleting leads, clients and proposals, converting leads, changing proposal status and editing agency settings write to `audit_logs`.
