import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import FormModal, { type FieldDef } from "../components/FormModal";
import { Badge, Button, Card, Confirm, ErrorState, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { cap, todayStr, useAction } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Client, ContentEntry, ContentKind } from "../lib/types";
import { KIND_LABEL } from "./ContentStudio";

export const STATUSES = ["idea", "draft", "in_review", "approved", "scheduled", "published"];
const PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X", "TikTok", "YouTube", "Blog", "Email"];
const tone = (s: string) => (({ published: "ok", scheduled: "info", approved: "info", in_review: "warn", draft: "muted", idea: "muted" }) as const)[s as "draft"] ?? "muted";
const chipColor = (s: string) => ({ published: "bg-oksoft text-ok", scheduled: "bg-infosoft text-info", approved: "bg-infosoft text-info", in_review: "bg-warnsoft text-warn" }[s] ?? "bg-surface2 text-muted border border-line");

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Monday-based start of the week. */
export const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
export function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = weekStart(first);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const weeks = Math.ceil(((weekStart(last).getTime() - start.getTime()) / 864e5 + 7) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

type View = "month" | "week" | "list";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [clientId, setClientId] = useState("");
  const [platform, setPlatform] = useState("");
  const [form, setForm] = useState<{ entry?: ContentEntry; date?: string } | null>(null);
  const [del, setDel] = useState<ContentEntry | null>(null);

  const days = useMemo(() => (view === "month" ? monthGrid(cursor) : Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i))), [view, cursor]);
  const range = view === "list" ? "" : `start=${iso(days[0])}&end=${iso(days[days.length - 1])}`;
  const qs = [range, clientId && `client_id=${clientId}`, platform && `platform=${encodeURIComponent(platform)}`].filter(Boolean).join("&");
  const entries = useQuery({ queryKey: ["content", "calendar", qs], queryFn: () => api<ContentEntry[]>(`/content${qs ? `?${qs}` : ""}`) });
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => api<Client[]>("/clients") });
  const save = useAction((p: { id?: number; body: Record<string, unknown> }) => api(p.id ? `/content/${p.id}` : "/content", { method: p.id ? "PATCH" : "POST", body: p.body }), { invalidate: ["content"], ok: "Saved" });
  const remove = useAction((e: ContentEntry) => api(`/content/${e.id}`, { method: "DELETE" }), { invalidate: ["content"], ok: "Deleted", done: () => setDel(null) });

  const byDay = useMemo(() => { const m = new Map<string, ContentEntry[]>(); for (const e of entries.data ?? []) if (e.publish_date) m.set(e.publish_date, [...(m.get(e.publish_date) ?? []), e]); return m; }, [entries.data]);
  const today = todayStr();
  const step = (n: number) => setCursor(view === "month" ? new Date(cursor.getFullYear(), cursor.getMonth() + n, 1) : addDays(cursor, 7 * n));
  const title = view === "month" ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : `Week of ${fmtDate(iso(days[0]))}`;

  const fields: FieldDef[] = [
    { key: "title", label: "Title", required: true, wide: true },
    { key: "kind", label: "Content type", kind: "select", options: (Object.keys(KIND_LABEL) as ContentKind[]).map((k) => [k, KIND_LABEL[k]]) },
    { key: "platform", label: "Platform", list: "platforms" },
    { key: "status", label: "Status", kind: "select", options: STATUSES.map((s) => [s, cap(s)]) },
    { key: "publish_date", label: "Publishing date", kind: "date", hint: "Planning only. Nothing is published automatically." },
    { key: "client_id", label: "Client", kind: "id", options: [["", "None"], ...(clients.data ?? []).map((c): [string, string] => [String(c.id), c.name])] },
    { key: "body", label: "Caption / text", kind: "textarea" },
    { key: "media_text", label: "Media references", kind: "textarea", hint: "One per line: a link or a file name. Files are not uploaded here." },
  ];

  const chip = (e: ContentEntry) => (
    <button key={e.id} onClick={() => setForm({ entry: e })} title={`${e.title} (${cap(e.status)})`} className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs ${chipColor(e.status)}`}>{e.platform ? `${e.platform} · ` : ""}{e.title}</button>
  );

  return (
    <>
      <PageHeader title="Content Calendar" subtitle="Plan content by date, client and platform. Publishing to social platforms is not connected: statuses are for planning."
        actions={<>
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Calendar view">
            {(["month", "week", "list"] as View[]).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${view === v ? "bg-accentsoft text-accent" : "text-muted"}`}>{cap(v)}</button>)}
          </div>
          <Button variant="primary" onClick={() => setForm({ date: today })}><Plus className="size-4" />Add content</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {view !== "list" && <><Button size="sm" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button><Button size="sm" onClick={() => setCursor(new Date())}>Today</Button><Button size="sm" aria-label="Next" onClick={() => step(1)}><ChevronRight className="size-4" /></Button><h2 className="ml-2 font-display text-lg font-semibold">{title}</h2></>}
        <div className="ml-auto flex gap-2">
          <Select aria-label="Filter by client" className="!w-auto" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">All clients</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select aria-label="Filter by platform" className="!w-auto" value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">All platforms</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</Select>
        </div>
      </div>
      <datalist id="platforms">{PLATFORMS.map((p) => <option key={p} value={p} />)}</datalist>

      {entries.isLoading ? <Spinner /> : entries.error ? <ErrorState error={entries.error} retry={entries.refetch} /> : view === "list" ? (
        <Card pad={false}>
          {!entries.data?.length ? <p className="p-6 text-center text-sm text-muted">No content planned yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Date", "Title", "Platform", "Client", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>{entries.data.map((e) => (
                <tr key={e.id} className="border-t border-line hover:bg-surface2">
                  <td className="px-4 py-2.5">{e.publish_date ? fmtDate(e.publish_date) : <span className="text-muted">Unscheduled</span>}</td>
                  <td className="px-4"><button className="font-medium text-accent hover:underline" onClick={() => setForm({ entry: e })}>{e.title}</button></td>
                  <td className="px-4">{e.platform || "—"}</td><td className="px-4">{clients.data?.find((c) => c.id === e.client_id)?.name ?? "—"}</td>
                  <td className="px-4"><Badge tone={tone(e.status)}>{cap(e.status)}</Badge></td>
                  <td className="px-4 text-right"><Button size="sm" variant="ghost" onClick={() => setDel(e)}>Delete</Button></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line" role="grid" aria-label={title}>
            {DOW.map((d) => <div key={d} role="columnheader" className="bg-surface2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{d}</div>)}
            {days.map((d) => {
              const key = iso(d), list = byDay.get(key) ?? [], other = view === "month" && d.getMonth() !== cursor.getMonth();
              const shown = view === "month" ? list.slice(0, 3) : list;
              return (
                <div key={key} role="gridcell" aria-label={key} className={`flex min-h-28 flex-col gap-1 bg-surface p-1.5 ${other ? "opacity-50" : ""}`}>
                  <button onClick={() => setForm({ date: key })} aria-label={`Add content on ${key}`} className={`self-start rounded px-1.5 text-xs font-medium hover:bg-surface2 ${key === today ? "bg-accent text-accentfg hover:bg-accent" : "text-muted"}`}>{d.getDate()}</button>
                  {shown.map(chip)}
                  {list.length > shown.length && <button className="text-left text-xs text-muted hover:text-fg" onClick={() => { setCursor(d); setView("week"); }}>+{list.length - shown.length} more</button>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {form && <FormModal title={form.entry ? "Edit content" : "Add content"} fields={fields} submitLabel="Save"
        footer={form.entry && <Button type="button" variant="danger" className="mr-auto" onClick={() => { setDel(form.entry!); setForm(null); }}>Delete</Button>}
        initial={form.entry ? { ...form.entry, media_text: form.entry.media.join("\n") } : { kind: "social_post", status: "idea", publish_date: form.date ?? "" }} onClose={() => setForm(null)}
        onSubmit={async ({ media_text, ...rest }) => { await save.mutateAsync({ id: form.entry?.id, body: { ...rest, media: String(media_text).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10) } }); }} />}
      {del && <Confirm title="Delete this content?" confirmLabel="Delete" busy={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => remove.mutate(del)} body={<>“{del.title}” will be permanently deleted.</>} />}
    </>
  );
}
