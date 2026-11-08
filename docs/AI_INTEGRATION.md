# AI integration (Phase C)

**Status: implemented and tested against mocked provider responses. No real Gemini, OpenAI or Groq request has been made from this project**, because no API key has been configured. Before relying on it, set a key and try each feature once. Model names change, so check `AI_MODEL`.

The deterministic SEO engine, CRM and every manual feature work with no AI configured. AI features show a notice and disable their buttons; the API returns `503`.

## Configure

In `backend/.env` (never commit it; keys are never sent to the browser):

```
AI_PROVIDER=groq            # gemini | openai | groq | none
GROQ_API_KEY=...            # the key matching the provider
AI_MODEL=                   # optional override; defaults live in backend/app/ai/provider.py
AI_REQUESTS_PER_HOUR=40     # per organisation
```

Restart the backend. Settings → AI providers shows the active provider and model (key presence only).

## How it is built

- `app/ai/provider.py`: one function, `complete(system, prompt, json_mode)`, over plain HTTPS (`httpx`; no vendor SDKs). OpenAI and Groq share the chat-completions shape; Gemini uses `generateContent`. The Gemini key is sent in the `x-goog-api-key` header, never in the URL. Only the three fixed provider hosts are ever contacted, so user input cannot redirect these requests.
- `app/ai/service.py`: `run_ai()` is the only way features call AI. It enforces the per-organisation hourly limit, writes an `ai_usage_logs` row (purpose, provider, model, token counts if reported, success), maps failures to safe messages (`503` unconfigured, `429` over budget, `502` provider problem) and never returns provider response bodies.
- Adding a provider means adding one function in `provider.py` and one entry in the resolution table.

## What the AI does, and what it cannot do

| Feature | Input it receives | Guard rails |
|---|---|---|
| SEO recommendations (audit page) | Up to 12 grouped **stored findings** (check, severity, count, up to 3 example URLs/evidence) and site context | Returned `check_id`s that were not supplied are discarded. It cannot add findings or change a score. Stored separately in `seo_recommendations` with provider and model. Reviewed (accepted/dismissed) items are kept when you regenerate. Nothing is applied to a website |
| Page rewrite | One page's title, description, H1 and headings | Returned for review only: not stored, not applied |
| Keyword suggestions | Seeds, category, location | Asked for terms, topic and intent only. Any volume, difficulty, CPC or ranking in the reply is ignored. Not saved until you pick items; saved as `ai_estimate`. Metric columns are filled only by people |
| Competitor insights | Counted facts from your latest audit and the competitor crawl | Split into *observed*, *interpretation*, *opportunities*; labelled AI. The prompt forbids claims about traffic, rankings or backlinks |
| Content studio | Your brief and, when revising, the previous draft | Returns editable text. Saved as a draft only when you save it, flagged `ai_generated`. Nothing is published anywhere |

All AI output carries an "AI-generated" label in the UI.

## Safety notes

- **Prompt injection:** page titles, evidence strings and anything else from websites or users are wrapped in `<data>…</data>` with embedded `data` tags stripped, and the system prompt says that content is untrusted. The model has no tools and no network or database access; its output is parsed as JSON or shown as plain text. This reduces, not eliminates, the chance of a manipulated answer, which is why a person reviews everything.
- **Data leaves your machine:** using a feature sends the inputs in the table above to your chosen provider. Lead and client personal data is not sent by any current feature. Check your provider's data terms before using client-confidential material in the Content Studio.
- **Cost:** hourly per-organisation cap, bounded prompts (12 finding groups, truncated strings), and a usage log. Token counts are recorded when the provider reports them; no prices are computed.

## Not done

- Real-provider verification (see the status above); streaming; function calling.
- AI lead qualification (the CRM uses transparent rules; the stored shape allows `source: "ai"` later).
- An in-app view of `ai_usage_logs` (the table is written; there is no UI yet).
- Internal-linking suggestions and content-gap ideas from the *own* site's pages beyond the recommendations above.
