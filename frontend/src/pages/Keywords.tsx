import { useQuery } from "@tanstack/react-query";
import { Download, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { AiBadge, AiNotice, useAi } from "../components/Ai";
import FormModal, { type FieldDef } from "../components/FormModal";
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { cap, useAction } from "../lib/crm";
import type { Audit, Intent, KeywordRow, KeywordSuggestion, PageRow, Website } from "../lib/types";

const INTENTS: Intent[] = ["informational", "navigational", "commercial", "transactional"];
const intentTone = (i: Intent) => ({ informational: "info", navigational: "muted", commercial: "warn", transactional: "ok" }[i] as "info" | "muted" | "warn" | "ok");
const num = (v: number | null) => (v == null ? "—" : String(v));

function fields(sites: Website[], pageUrls: string[]): FieldDef[] {
  return [
    { key: "term", label: "Keyword", required: true, wide: true },
    { key: "website_id", label: "Website", kind: "id", options: [["", "Not tied to a website"], ...sites.map((s): [string, string] => [String(s.id), s.name])] },
    { key: "intent", label: "Search intent", kind: "select", options: INTENTS.map((i) => [i, cap(i)]) },
    { key: "topic", label: "Topic group" },
    { key: "mapped_url", label: "Mapped page", list: "page-urls", hint: pageUrls.length ? `Pick or type a page URL. ${pageUrls.length} pages known from the latest audit.` : "Type the page URL this keyword targets." },
    { key: "search_volume", label: "Monthly searches", kind: "number", hint: "Enter only a figure from a tool you trust." },
    { key: "difficulty", label: "Difficulty (0-100)", kind: "number", step: "any" },
    { key: "cpc", label: "CPC", kind: "number", step: "any" },
    { key: "position", label: "Current ranking position", kind: "number", step: "any" },
    { key: "metrics_source", label: "Where the numbers came from", placeholder: "e.g. Search Console export, Semrush, manual entry" },
    { key: "notes", label: "Notes", kind: "textarea" },
  ];
}

function Suggest({ sites, websiteId, onClose }: { sites: Website[]; websiteId: number | null; onClose: () => void }) {
  const [seeds, setSeeds] = useState("");
  const [site, setSite] = useState(websiteId ? String(websiteId) : "");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [result, setResult] = useState<KeywordSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const gen = useAction(() => api<{ suggestions: KeywordSuggestion[] }>("/keywords/suggest", { method: "POST", body: { seeds: seeds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10), website_id: site ? Number(site) : null, category, location } }),
    { invalidate: ["usage"], done: (r) => { setResult(r.suggestions); setPicked(new Set(r.suggestions.map((s) => s.term))); } });
  const save = useAction(() => api("/keywords/bulk", { method: "POST", body: { keywords: (result ?? []).filter((s) => picked.has(s.term)).map((s) => ({ term: s.term, intent: s.intent, topic: s.topic, source: "ai_estimate", website_id: site ? Number(site) : null, notes: s.rationale })) } }),
    { invalidate: ["keywords"], ok: "Keywords saved", done: onClose });

  return (
    <Modal title="Suggest keywords with AI" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="rounded-lg bg-surface2 p-3 text-muted">Suggestions are qualitative AI estimates. They carry <strong>no search volume, difficulty, CPC or ranking data</strong>; add verified numbers yourself later.</p>
        <label className="block"><span className="mb-1 block font-medium">Seed keywords (comma separated)</span><input className="w-full rounded-lg border border-line bg-surface px-3 py-2" value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="plumber, boiler repair" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="mb-1 block font-medium">Website</span><Select value={site} onChange={(e) => setSite(e.target.value)}><option value="">None</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
          <label><span className="mb-1 block font-medium">Business category</span><input className="w-full rounded-lg border border-line bg-surface px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label><span className="mb-1 block font-medium">Target location</span><input className="w-full rounded-lg border border-line bg-surface px-3 py-2" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        </div>
        <Button variant="primary" busy={gen.isPending} disabled={!seeds.trim()} onClick={() => gen.mutate()}><Sparkles className="size-4" />Generate suggestions</Button>
        {result && (
          <>
            {!result.length ? <p className="text-muted">The AI returned no usable suggestions.</p> : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {result.map((s) => (
                  <li key={s.term} className="flex items-start gap-3 p-2">
                    <input type="checkbox" className="mt-1" aria-label={`Select ${s.term}`} checked={picked.has(s.term)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(s.term) ? n.delete(s.term) : n.add(s.term); return n; })} />
                    <div className="min-w-0 flex-1"><div className="font-medium">{s.term}</div><div className="text-xs text-muted">{s.topic}{s.rationale ? ` · ${s.rationale}` : ""}</div></div>
                    <Badge tone={intentTone(s.intent)}>{cap(s.intent)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={!picked.size} onClick={() => save.mutate()}>Save {picked.size} selected</Button></div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function KeywordsPage() {
  const ai = useAi();
  const sites = useQuery({ queryKey: ["websites"], queryFn: () => api<Website[]>("/websites") });
  const [siteId, setSiteId] = useState<number | null>(null);
  const [form, setForm] = useState<"new" | KeywordRow | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [del, setDel] = useState<KeywordRow | null>(null);
  const kws = useQuery({ queryKey: ["keywords", siteId], queryFn: () => api<KeywordRow[]>(`/keywords${siteId ? `?website_id=${siteId}` : ""}`) });
  // Page URLs from the most recent audit of the selected site, offered as mapping targets.
  const audits = useQuery({ queryKey: ["audits", siteId], enabled: !!siteId, queryFn: () => api<Audit[]>(`/websites/${siteId}/audits`) });
  const latest = audits.data?.find((a) => a.status === "completed" && a.mode === "site");
  const pages = useQuery({ queryKey: ["pages", latest?.id], enabled: !!latest, queryFn: () => api<PageRow[]>(`/audits/${latest!.id}/pages`) });
  const pageUrls = (pages.data ?? []).map((p) => p.url);
  const save = useAction((p: { id?: number; body: Record<string, unknown> }) => api(p.id ? `/keywords/${p.id}` : "/keywords", { method: p.id ? "PATCH" : "POST", body: p.body }), { invalidate: ["keywords"], ok: "Keyword saved" });
  const remove = useAction((k: KeywordRow) => api(`/keywords/${k.id}`, { method: "DELETE" }), { invalidate: ["keywords"], ok: "Keyword deleted", done: () => setDel(null) });
  const list = kws.data ?? [];
  const topics = [...new Set(list.map((k) => k.topic || "Ungrouped"))];

  return (
    <>
      <PageHeader title="Keyword Intelligence" subtitle="Your keyword research workspace. Metrics are only what you enter or import: nothing is estimated."
        actions={<>
          <Select aria-label="Website" className="!w-auto" value={siteId ?? ""} onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : null)}><option value="">All websites</option>{(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <a href={`/api/keywords/export.csv${siteId ? `?website_id=${siteId}` : ""}`} download><Button><Download className="size-4" />Export CSV</Button></a>
          <Button disabled={!ai.configured} title={ai.configured ? undefined : "AI is not configured"} onClick={() => setSuggest(true)}><Sparkles className="size-4" />Suggest with AI</Button>
          <Button variant="primary" onClick={() => setForm("new")}><Plus className="size-4" />Add keyword</Button>
        </>} />
      <AiNotice />
      {kws.isLoading ? <Spinner /> : kws.error ? <ErrorState error={kws.error} retry={kws.refetch} /> : !list.length ? (
        <EmptyState title="No keywords yet" body="Add keywords by hand, or ask AI for ideas based on seed terms. Search volume and difficulty are never generated for you." action={<Button variant="primary" onClick={() => setForm("new")}><Plus className="size-4" />Add keyword</Button>} />
      ) : topics.map((t) => (
        <Card key={t} pad={false} className="mb-4">
          <div className="p-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Keyword", "Intent", "Mapped page", "Volume", "Difficulty", "CPC", "Position", "Source", ""].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {list.filter((k) => (k.topic || "Ungrouped") === t).map((k) => (
                  <tr key={k.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">{k.term}</td><td className="px-4"><Badge tone={intentTone(k.intent)}>{cap(k.intent)}</Badge></td>
                    <td className="max-w-48 truncate px-4 text-muted" title={k.mapped_url}>{k.mapped_url || "—"}</td>
                    <td className="num px-4">{num(k.search_volume)}</td><td className="num px-4">{num(k.difficulty)}</td><td className="num px-4">{num(k.cpc)}</td><td className="num px-4">{num(k.position)}</td>
                    <td className="px-4">{k.source === "ai_estimate" ? <AiBadge label="AI idea" /> : <span className="text-xs text-muted">{k.metrics_source || cap(k.source)}</span>}</td>
                    <td className="px-4 text-right"><Button size="sm" variant="ghost" aria-label={`Edit ${k.term}`} onClick={() => setForm(k)}><Pencil className="size-3.5" /></Button><Button size="sm" variant="ghost" aria-label={`Delete ${k.term}`} onClick={() => setDel(k)}><Trash2 className="size-3.5" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {pageUrls.length > 0 && <datalist id="page-urls">{pageUrls.map((u) => <option key={u} value={u} />)}</datalist>}
      {form && <FormModal title={form === "new" ? "Add keyword" : "Edit keyword"} fields={fields(sites.data ?? [], pageUrls)} initial={form === "new" ? { intent: "informational", website_id: siteId ?? "" } : { ...form }} submitLabel="Save keyword"
        onSubmit={(b) => save.mutateAsync({ id: form === "new" ? undefined : form.id, body: { ...b, source: form === "new" ? "manual" : form.source } })} onClose={() => setForm(null)} />}
      {suggest && <Suggest sites={sites.data ?? []} websiteId={siteId} onClose={() => setSuggest(false)} />}
      {del && <Modal title="Delete keyword?" onClose={() => setDel(null)}><p className="text-sm text-muted">“{del.term}” will be permanently deleted.</p><div className="mt-4 flex justify-end gap-2"><Button onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate(del)}>Delete keyword</Button></div></Modal>}
    </>
  );
}
