import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import FormModal from "../components/FormModal";
import { Badge, Button, Card, Confirm, ErrorState, Input, PageHeader, SectionTitle, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { CLIENT_STATUSES, cap, money, safeHref, useAction, useCurrency } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Activity, Client, OnboardingItem, Proposal } from "../lib/types";
import { CLIENT_FIELDS, clientTone } from "./Clients";
import { AddActivity, Timeline } from "./LeadDetail";

function Onboarding({ client }: { client: Client }) {
  const id = client.id;
  const items = useQuery({ queryKey: ["onboarding", id], queryFn: () => api<OnboardingItem[]>(`/clients/${id}/onboarding`) });
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState<OnboardingItem | null>(null);
  const inv = ["onboarding", "clients", "client"];
  const start = useAction(() => api(`/clients/${id}/onboarding/start`, { method: "POST" }), { invalidate: [...inv, "history"], ok: "Onboarding checklist created" });
  const toggle = useAction((i: OnboardingItem) => api(`/onboarding/${i.id}`, { method: "PATCH", body: { done: !i.done } }), { invalidate: inv });
  const add = useAction(() => api(`/clients/${id}/onboarding`, { method: "POST", body: { title } }), { invalidate: inv, done: () => setTitle("") });
  const remove = useAction((i: OnboardingItem) => api(`/onboarding/${i.id}`, { method: "DELETE" }), { invalidate: inv });
  const list = items.data ?? [], done = list.filter((i) => i.done).length;

  return (
    <Card>
      <SectionTitle aside={list.length > 0 && <span className="num text-xs text-muted">{done} of {list.length} done</span>}>Onboarding</SectionTitle>
      {items.isLoading ? <Spinner /> : !list.length ? (
        <div className="text-sm"><p className="mb-3 text-muted">No checklist yet. Start one from the standard template, then tailor it.</p><Button variant="primary" busy={start.isPending} onClick={() => start.mutate()}>Start onboarding</Button></div>
      ) : (
        <>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Onboarding progress" aria-valuenow={done} aria-valuemax={list.length}><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / list.length) * 100}%` }} /></div>
          <ul className="space-y-1">
            {list.map((i) => (
              <li key={i.id} className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-surface2">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={i.done} onChange={() => toggle.mutate(i)} aria-label={i.title} />
                <span className={`flex-1 text-sm ${i.done ? "text-muted line-through" : ""}`}>{i.title}</span>
                <button className="rounded p-1 text-muted hover:text-fg" aria-label={`Rename ${i.title}`} onClick={() => setRenaming(i)}><Pencil className="size-3.5" /></button>
                <button className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${i.title}`} onClick={() => remove.mutate(i)}><Trash2 className="size-3.5" /></button>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
            <Input aria-label="New checklist item" placeholder="Add a checklist item…" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" disabled={!title.trim()} busy={add.isPending}><Plus className="size-4" />Add</Button>
          </form>
          <p className="mt-3 text-xs text-muted">Never ask a client to send passwords through forms, email or chat. Use invitations, delegated access or a password manager.</p>
        </>
      )}
      {renaming && <FormModal title="Rename item" fields={[{ key: "title", label: "Title", required: true, wide: true }]} initial={{ title: renaming.title }} submitLabel="Save"
        onSubmit={(p) => api(`/onboarding/${renaming.id}`, { method: "PATCH", body: p }).then(() => items.refetch())} onClose={() => setRenaming(null)} />}
    </Card>
  );
}

export default function ClientDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const currency = useCurrency();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const client = useQuery({ queryKey: ["client", id], queryFn: () => api<Client>(`/clients/${id}`) });
  const history = useQuery({ queryKey: ["history", id], queryFn: () => api<Activity[]>(`/clients/${id}/history`) });
  const proposals = useQuery({ queryKey: ["proposals", "client", id], queryFn: () => api<Proposal[]>("/proposals") });
  const inv = ["client", "clients", "overview"];
  const save = useAction((body: Record<string, unknown>) => api(`/clients/${id}`, { method: "PATCH", body }), { invalidate: [...inv, "history"], ok: "Client updated" });
  const remove = useAction(() => api(`/clients/${id}`, { method: "DELETE" }), { invalidate: [...inv, "proposals"], ok: "Client deleted", done: () => nav("/clients") });

  if (client.isLoading) return <Spinner />;
  if (client.error || !client.data) return <ErrorState error={client.error ?? new Error("Client not found")} />;
  const c = client.data, href = safeHref(c.website);
  const mine = (proposals.data ?? []).filter((p) => p.client_id === id);
  const dl = (k: string, v: React.ReactNode) => v ? <div className="flex justify-between gap-4 border-t border-line py-2 text-sm first:border-t-0"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words text-right">{v}</dd></div> : null;

  return (
    <>
      <PageHeader title={c.name} subtitle={<>{c.company || "No company"} · client since {fmtDate(c.created_at)}</>}
        actions={<>
          <Select aria-label="Client status" className="!w-auto" value={c.status} onChange={(e) => save.mutate({ status: e.target.value })}>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>
          <Link to={`/proposals/new?client=${c.id}`}><Button><FilePlus2 className="size-4" />New proposal</Button></Link>
          <Button onClick={() => setEdit(true)}><Pencil className="size-4" />Edit</Button>
          <Button variant="ghost" aria-label="Delete client" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>
        </>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle aside={<Badge tone={clientTone(c.status)}>{cap(c.status)}</Badge>}>Details</SectionTitle>
          <dl>
            {dl("Email", c.email && <a className="text-accent hover:underline" href={`mailto:${c.email}`}>{c.email}</a>)}
            {dl("Phone", c.phone)}
            {dl("Website", c.website && (href ? <a className="text-accent hover:underline" href={href} target="_blank" rel="noopener noreferrer">{c.website}</a> : c.website))}
            {dl("Monthly value", c.monthly_value > 0 && money(c.monthly_value, currency))}
            {dl("Contract", c.contract_start && `${fmtDate(c.contract_start)} → ${fmtDate(c.contract_end)}`)}
            {dl("Source lead", c.source_lead_id && <Link className="text-accent hover:underline" to={`/leads/${c.source_lead_id}`}>Lead #{c.source_lead_id}</Link>)}
          </dl>
          {c.services && <><div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Services purchased</div><p className="whitespace-pre-wrap text-sm">{c.services}</p></>}
          {c.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-sm">{c.notes}</p>}
        </Card>
        <Onboarding client={c} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Proposals</SectionTitle>
          {!mine.length ? <p className="text-sm text-muted">No proposals for this client yet.</p> : (
            <ul className="divide-y divide-line text-sm">{mine.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 py-2"><Link className="font-medium text-accent hover:underline" to={`/proposals/${p.id}`}>{p.title}</Link><span className="flex items-center gap-2"><span className="num">{money(p.total, currency)}</span><Badge>{cap(p.status)}</Badge></span></li>)}</ul>
          )}
        </Card>
        <Card>
          <SectionTitle>History</SectionTitle>
          <AddActivity path={`/clients/${id}/activities`} invalidate={["history"]} />
          {history.isLoading ? <Spinner /> : <Timeline items={history.data ?? []} />}
        </Card>
      </div>
      {edit && <FormModal title="Edit client" fields={CLIENT_FIELDS} initial={{ ...c }} submitLabel="Save changes" onSubmit={(p) => save.mutateAsync(p)} onClose={() => setEdit(false)} />}
      {del && <Confirm title="Delete this client?" confirmLabel="Delete client" busy={remove.isPending} onCancel={() => setDel(false)} onConfirm={() => remove.mutate()} body="The client, its onboarding checklist and history are permanently deleted. Proposals are kept but lose the link to this client." />}
    </>
  );
}
