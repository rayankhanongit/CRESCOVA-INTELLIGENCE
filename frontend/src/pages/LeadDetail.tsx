import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Pencil, Sparkles, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import FormModal from "../components/FormModal";
import { Badge, Button, Card, Confirm, ErrorState, PageHeader, SectionTitle, Select, Spinner, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { LEAD_STAGES, cap, money, safeHref, useAction, useCurrency } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Activity, Client, Lead, LeadStatus } from "../lib/types";
import { LEAD_FIELDS } from "./Leads";

export function Timeline({ items }: { items: Activity[] }) {
  if (!items.length) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <Badge tone={a.kind === "status_change" ? "info" : a.kind === "qualification" ? "accent" : "muted"}>{cap(a.kind.replace("_", " "))}</Badge>
          <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words">{a.text}</p><p className="text-xs text-muted">{fmtDate(a.created_at, true)}</p></div>
        </li>
      ))}
    </ol>
  );
}

export function AddActivity({ path, invalidate }: { path: string; invalidate: string[] }) {
  const [kind, setKind] = useState("note");
  const [text, setText] = useState("");
  const add = useAction(() => api(path, { method: "POST", body: { kind, text } }), { invalidate, ok: "Added to timeline", done: () => setText("") });
  return (
    <form className="mb-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
      <div className="flex gap-2">
        <Select aria-label="Interaction type" className="!w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>{["note", "call", "email", "meeting"].map((k) => <option key={k} value={k}>{cap(k)}</option>)}</Select>
        <Textarea aria-label="Interaction details" className="!min-h-10 flex-1" rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Record a note or interaction…" />
      </div>
      <Button type="submit" size="sm" busy={add.isPending} disabled={!text.trim()}>Add to timeline</Button>
    </form>
  );
}

export default function LeadDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const currency = useCurrency();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => api<Lead>(`/leads/${id}`) });
  const acts = useQuery({ queryKey: ["leads", "activities", id], queryFn: () => api<Activity[]>(`/leads/${id}/activities`) });
  const inv = ["lead", "leads", "overview"];
  const patch = useAction((body: Record<string, unknown>) => api(`/leads/${id}`, { method: "PATCH", body }), { invalidate: inv });
  const save = useAction((body: Record<string, unknown>) => api(`/leads/${id}`, { method: "PATCH", body }), { invalidate: [...inv, "leads"], ok: "Lead updated" });
  const qualify = useAction(() => api(`/leads/${id}/qualify`, { method: "POST" }), { invalidate: inv, ok: "Qualification updated" });
  const convert = useAction(() => api<Client>(`/leads/${id}/convert`, { method: "POST" }), { invalidate: [...inv, "clients"], ok: "Converted to client", done: (c) => nav(`/clients/${c.id}`) });
  const remove = useAction(() => api(`/leads/${id}`, { method: "DELETE" }), { invalidate: inv, ok: "Lead deleted", done: () => nav("/leads") });

  if (lead.isLoading) return <Spinner />;
  if (lead.error || !lead.data) return <ErrorState error={lead.error ?? new Error("Lead not found")} />;
  const l = lead.data, q = l.qualification, href = safeHref(l.website);
  const dl = (k: string, v: React.ReactNode) => v ? <div className="flex justify-between gap-4 border-t border-line py-2 text-sm first:border-t-0"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words text-right">{v}</dd></div> : null;

  return (
    <>
      <PageHeader title={l.name} subtitle={<>{l.company || "No company"} · added {fmtDate(l.created_at)}</>}
        actions={<>
          <Select aria-label="Pipeline status" className="!w-auto" value={l.status} onChange={(e) => patch.mutate({ status: e.target.value as LeadStatus })}>
            {LEAD_STAGES.map((s) => <option key={s.key} value={s.key} disabled={s.key === "converted" && l.status !== "converted"}>{s.label}</option>)}
          </Select>
          <Button onClick={() => setEdit(true)}><Pencil className="size-4" />Edit</Button>
          <Button variant="ghost" aria-label="Delete lead" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>
        </>} />

      <div className="mb-4 flex flex-wrap gap-2">
        {l.client_id ? <Link to={`/clients/${l.client_id}`}><Button variant="primary"><UserCheck className="size-4" />Open client</Button></Link>
          : <Button variant="primary" busy={convert.isPending} onClick={() => convert.mutate()}><UserCheck className="size-4" />Convert to client</Button>}
        <Link to={`/proposals/new?lead=${l.id}`}><Button><FilePlus2 className="size-4" />Create proposal</Button></Link>
        <Button busy={qualify.isPending} onClick={() => qualify.mutate()}><Sparkles className="size-4" />Qualify (rules-based)</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Details</SectionTitle>
          <dl>
            {dl("Email", l.email && <a className="text-accent hover:underline" href={`mailto:${l.email}`}>{l.email}</a>)}
            {dl("Phone", l.phone)}
            {dl("Website", l.website && (href ? <a className="text-accent hover:underline" href={href} target="_blank" rel="noopener noreferrer">{l.website}</a> : l.website))}
            {dl("Service", l.service_interest)}
            {dl("Budget", l.budget != null && money(l.budget, currency))}
            {dl("Source", l.source)}
            {dl("Priority", l.priority ? cap(l.priority) : <span className="text-muted">Not set</span>)}
            {dl("Last contacted", l.last_contacted_at && fmtDate(l.last_contacted_at, true))}
            {dl("Next follow-up", l.next_follow_up && fmtDate(l.next_follow_up))}
          </dl>
          {l.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-sm">{l.notes}</p>}
        </Card>

        <Card>
          <SectionTitle aside={q && <Badge tone="accent">{q.label}</Badge>}>Qualification</SectionTitle>
          {!q ? <p className="text-sm text-muted">Not assessed yet. “Qualify” checks the recorded details against your pricing packages. It only suggests: it never changes the status or rejects a lead.</p> : (
            <div className="space-y-3 text-sm">
              <p>{q.summary}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Suggested priority</span><Badge tone={q.suggested_priority === "high" ? "danger" : q.suggested_priority === "medium" ? "warn" : "muted"}>{cap(q.suggested_priority)}</Badge>
                <span className="text-muted">Your priority</span><Badge>{l.priority ? cap(l.priority) : "Not set"}</Badge>
                {l.priority !== q.suggested_priority && <Button size="sm" onClick={() => patch.mutate({ priority: q.suggested_priority })}>Use suggestion</Button>}
              </div>
              {q.service_fit.length > 0 && <p><span className="text-muted">Matching packages:</span> {q.service_fit.join(", ")}</p>}
              <p><span className="font-medium">Suggested next action:</span> {q.next_action}</p>
              <div><div className="mb-1 font-medium">Questions to ask</div><ul className="list-disc space-y-0.5 pl-5">{q.follow_up_questions.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <details><summary className="cursor-pointer text-muted">How the score of {q.score} was reached</summary>
                <ul className="mt-2 space-y-0.5">{q.signals.map((s) => <li key={s.label} className="flex justify-between gap-3"><span>{s.label}</span><span className="num text-muted">{s.points > 0 ? "+" : ""}{s.points}</span></li>)}</ul>
              </details>
              <p className="text-xs text-muted">Assessed {fmtDate(q.generated_at, true)}. Review and override anything here.</p>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <SectionTitle>Activity timeline</SectionTitle>
        <AddActivity path={`/leads/${id}/activities`} invalidate={["leads", "lead"]} />
        {acts.isLoading ? <Spinner /> : <Timeline items={acts.data ?? []} />}
      </Card>

      {edit && <FormModal title="Edit lead" fields={LEAD_FIELDS} initial={{ ...l }} submitLabel="Save changes" onClose={() => setEdit(false)}
        onSubmit={(p) => save.mutateAsync(p)} />}
      {del && <Confirm title="Delete this lead?" confirmLabel="Delete lead" busy={remove.isPending} onCancel={() => setDel(false)} onConfirm={() => remove.mutate()} body="The lead and its timeline are permanently deleted. Clients and proposals created from it are kept." />}
    </>
  );
}
