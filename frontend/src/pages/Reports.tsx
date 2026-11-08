import { useQuery } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { useAction } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Client, ReportDetailData, ReportRow, Website } from "../lib/types";
import { iso } from "./Calendar";

export const SECTIONS: { key: string; label: string; hint: string; needs?: "website" | "client" }[] = [
  { key: "seo", label: "SEO audit scores and issues", hint: "Measured by the crawler", needs: "website" },
  { key: "keywords", label: "Keywords", hint: "Entered or imported by your team", needs: "website" },
  { key: "tasks", label: "Completed tasks", hint: "From your task records" },
  { key: "recommendations", label: "Accepted AI recommendations", hint: "AI-written, reviewed by a person", needs: "website" },
  { key: "progress", label: "Project progress (onboarding)", hint: "From your client records", needs: "client" },
  { key: "content", label: "Content published or planned", hint: "From your content calendar" },
  { key: "notes", label: "Your own notes", hint: "Written by you below" },
];

const presets = () => {
  const now = new Date(), d = (y: number, m: number, day: number) => iso(new Date(y, m, day));
  return [
    ["Last 30 days", iso(new Date(now.getTime() - 29 * 864e5)), iso(now)],
    ["This month", d(now.getFullYear(), now.getMonth(), 1), iso(now)],
    ["Last month", d(now.getFullYear(), now.getMonth() - 1, 1), d(now.getFullYear(), now.getMonth(), 0)],
    ["Last 90 days", iso(new Date(now.getTime() - 89 * 864e5)), iso(now)],
  ] as const;
};

function Generate({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const sites = useQuery({ queryKey: ["websites"], queryFn: () => api<Website[]>("/websites") });
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => api<Client[]>("/clients") });
  const [p0] = presets();
  const [f, setF] = useState({ title: "", website_id: "", client_id: "", period_start: p0[1], period_end: p0[2], notes: "" });
  const [picked, setPicked] = useState<Set<string>>(new Set(["seo", "tasks"]));
  const [error, setError] = useState<string | null>(null);
  const gen = useAction((b: unknown) => api<ReportDetailData>("/reports", { method: "POST", body: b }), { invalidate: ["reports"], ok: "Report generated", done: (r) => { onClose(); nav(`/reports/${r.id}`); } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function submit() {
    if (!f.title.trim()) return setError("Give the report a title.");
    if (!f.website_id && !f.client_id) return setError("Choose a website, a client, or both.");
    if (f.period_end < f.period_start) return setError("The period end must not be before the start.");
    if (!picked.size) return setError("Choose at least one section.");
    setError(null);
    gen.mutate({ title: f.title, website_id: f.website_id ? Number(f.website_id) : null, client_id: f.client_id ? Number(f.client_id) : null, period_start: f.period_start, period_end: f.period_end, sections: [...picked], notes: f.notes });
  }

  return (
    <Modal title="Generate report" onClose={onClose} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Title *">{(id) => <Input id={id} value={f.title} onChange={set("title")} placeholder="Acme: October SEO report" />}</Field></div>
        <Field label="Website">{(id) => <Select id={id} value={f.website_id} onChange={set("website_id")}><option value="">None</option>{(sites.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
        <Field label="Client">{(id) => <Select id={id} value={f.client_id} onChange={set("client_id")}><option value="">None</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Period start">{(id) => <Input id={id} type="date" value={f.period_start} onChange={set("period_start")} />}</Field>
        <Field label="Period end">{(id) => <Input id={id} type="date" value={f.period_end} onChange={set("period_end")} />}</Field>
        <div className="flex flex-wrap gap-1.5 sm:col-span-2">{presets().map(([label, a, b]) => <Button key={label} size="sm" type="button" onClick={() => setF({ ...f, period_start: a, period_end: b })}>{label}</Button>)}</div>
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">Sections</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">{SECTIONS.map((s) => (
            <label key={s.key} className="flex items-start gap-2 rounded-lg border border-line p-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={picked.has(s.key)} onChange={() => setPicked((x) => { const n = new Set(x); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })} />
              <span><span className="font-medium">{s.label}</span><span className="block text-xs text-muted">{s.hint}{s.needs && !f[`${s.needs}_id`] ? ` · needs a ${s.needs}` : ""}</span></span>
            </label>))}</div>
        </fieldset>
        <div className="sm:col-span-2"><Field label="Your notes" hint="Shown only if the notes section is selected, and labelled as written by your team.">{(id) => <Textarea id={id} value={f.notes} onChange={set("notes")} />}</Field></div>
        <p className="rounded-lg bg-surface2 p-3 text-xs text-muted sm:col-span-2">Google Analytics and Search Console are not connected, so reports contain no traffic, impressions, clicks or ranking positions. Every section says where its data came from.</p>
        {error && <p role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={gen.isPending} onClick={submit}>Generate</Button></div>
      </div>
    </Modal>
  );
}

export default function ReportsPage() {
  const [open, setOpen] = useState(false);
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => api<ReportRow[]>("/reports") });
  return (
    <>
      <PageHeader title="Reports" subtitle="Client-ready snapshots of your stored data for a chosen period, exportable as PDF, CSV or JSON."
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" />Generate report</Button>} />
      {reports.isLoading ? <Spinner /> : reports.error ? <ErrorState error={reports.error} retry={reports.refetch} /> : !reports.data?.length ? (
        <EmptyState icon={<BarChart3 className="size-6" />} title="No reports yet" body="Generate a report for a website or client. It's a saved snapshot, so exports never change later." action={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" />Generate report</Button>} />
      ) : (
        <Card pad={false}><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr>{["Report", "Period", "Sections", "Created"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{reports.data.map((r) => (
            <tr key={r.id} className="border-t border-line hover:bg-surface2">
              <td className="px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/reports/${r.id}`}>{r.title}</Link></td>
              <td className="px-4 text-muted">{fmtDate(r.period_start)} to {fmtDate(r.period_end)}</td><td className="px-4">{r.sections.length}</td><td className="px-4 text-muted">{fmtDate(r.created_at)}</td>
            </tr>))}</tbody>
        </table></div></Card>
      )}
      {open && <Generate onClose={() => setOpen(false)} />}
    </>
  );
}
