import { useQuery } from "@tanstack/react-query";
import { Download, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Confirm, ErrorState, Field, Input, PageHeader, SectionTitle, Select, Spinner, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { cap, money, proposalTotals, useAction, useCurrency } from "../lib/crm";
import type { Client, Lead, Pkg, Proposal, ProposalItem, ProposalStatus } from "../lib/types";
import { proposalTone } from "./Proposals";

interface Draft { lead_id: string; client_id: string; title: string; description: string; deliverables: string; timeline: string; payment_terms: string; discount_percent: string; valid_until: string; items: ProposalItem[] }
const blank: Draft = { lead_id: "", client_id: "", title: "", description: "", deliverables: "", timeline: "", payment_terms: "", discount_percent: "0", valid_until: "", items: [] };

function toDraft(p: Proposal): Draft {
  return { lead_id: String(p.lead_id ?? ""), client_id: String(p.client_id ?? ""), title: p.title, description: p.description, deliverables: p.deliverables, timeline: p.timeline,
    payment_terms: p.payment_terms, discount_percent: String(p.discount_percent), valid_until: p.valid_until ?? "", items: p.items.map((i) => ({ package_id: i.package_id, description: i.description, quantity: i.quantity, unit_price: i.unit_price })) };
}

const NEXT: Record<ProposalStatus, { to: ProposalStatus; label: string }[]> = {
  draft: [{ to: "sent", label: "Mark as sent" }],
  sent: [{ to: "accepted", label: "Mark accepted" }, { to: "rejected", label: "Mark rejected" }, { to: "draft", label: "Back to draft" }],
  accepted: [{ to: "draft", label: "Back to draft" }], rejected: [{ to: "draft", label: "Back to draft" }], expired: [{ to: "draft", label: "Back to draft" }],
};

export default function ProposalEditor() {
  const rawId = useParams().id;
  const isNew = rawId === "new";
  const id = Number(rawId);
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const currency = useCurrency();
  const [draft, setDraft] = useState<Draft | null>(isNew ? { ...blank, lead_id: sp.get("lead") ?? "", client_id: sp.get("client") ?? "" } : null);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState(false);

  const saved = useQuery({ queryKey: ["proposal", id], enabled: !isNew, queryFn: async () => { const p = await api<Proposal>(`/proposals/${id}`); setDraft(toDraft(p)); return p; } });
  const leads = useQuery({ queryKey: ["leads", ""], queryFn: () => api<Lead[]>("/leads") });
  const clients = useQuery({ queryKey: ["clients", ""], queryFn: () => api<Client[]>("/clients") });
  const packages = useQuery({ queryKey: ["packages"], queryFn: () => api<Pkg[]>("/packages") });

  const inv = ["proposal", "proposals", "leads", "lead", "overview", "history"];
  const save = useAction((body: unknown) => (isNew ? api<Proposal>("/proposals", { method: "POST", body }) : api<Proposal>(`/proposals/${id}`, { method: "PATCH", body })),
    { invalidate: inv, ok: "Proposal saved", done: (p) => (isNew ? nav(`/proposals/${p.id}`, { replace: true }) : setDraft(toDraft(p))) });
  const status = useAction((to: ProposalStatus) => api<Proposal>(`/proposals/${id}/status`, { method: "POST", body: { status: to } }), { invalidate: inv, ok: "Status updated" });
  const startOnboarding = useAction((cid: number) => api(`/clients/${cid}/onboarding/start`, { method: "POST" }), { invalidate: ["onboarding", "clients"], ok: "Onboarding started", done: () => nav(`/clients/${saved.data?.client_id}`) });
  const remove = useAction(() => api(`/proposals/${id}`, { method: "DELETE" }), { invalidate: inv, ok: "Proposal deleted", done: () => nav("/proposals") });

  if (!isNew && saved.isLoading) return <Spinner />;
  if (!isNew && (saved.error || !saved.data)) return <ErrorState error={saved.error ?? new Error("Proposal not found")} />;
  if (!draft) return <Spinner />;

  const p = saved.data, locked = !isNew && p?.status !== "draft";
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const setItem = (n: number, patch: Partial<ProposalItem>) => setDraft({ ...draft, items: draft.items.map((it, i) => (i === n ? { ...it, ...patch } : it)) });
  const dirty = !isNew && !!p && JSON.stringify(draft) !== JSON.stringify(toDraft(p));
  const totals = proposalTotals(draft.items, Number(draft.discount_percent) || 0);

  function submit() {
    if (!draft!.title.trim()) return setError("Give the proposal a title.");
    if (!draft!.lead_id && !draft!.client_id) return setError("Choose a lead or a client.");
    if (draft!.items.some((i) => !i.description.trim())) return setError("Every line item needs a description.");
    setError(null);
    save.mutate({ ...draft, lead_id: draft!.lead_id ? Number(draft!.lead_id) : null, client_id: draft!.client_id ? Number(draft!.client_id) : null,
      discount_percent: Number(draft!.discount_percent) || 0, valid_until: draft!.valid_until || null });
  }

  return (
    <>
      <PageHeader title={isNew ? "New proposal" : draft.title || "Proposal"} subtitle={!isNew && p && <><Badge tone={proposalTone(p.status)}>{cap(p.status)}</Badge> <span className="ml-2">For {p.recipient_name || "—"}</span></>}
        actions={!isNew && p && <>
          <a href={`/api/proposals/${p.id}/pdf`} download><Button><Download className="size-4" />Download PDF</Button></a>
          <Button variant="ghost" aria-label="Delete proposal" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>
        </>} />

      {!isNew && p && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {NEXT[p.status].map((n) => <Button key={n.to} variant={n.to === "sent" || n.to === "accepted" ? "primary" : "secondary"} busy={status.isPending} disabled={dirty} onClick={() => status.mutate(n.to)}>{n.label}</Button>)}
            {p.status === "accepted" && (p.client_id
              ? <Button onClick={() => startOnboarding.mutate(p.client_id!)} busy={startOnboarding.isPending}>Start client onboarding</Button>
              : <span className="text-sm text-muted">To start onboarding, <Link className="text-accent hover:underline" to={`/leads/${p.lead_id}`}>convert the lead to a client</Link> first.</span>)}
          </div>
          <p className="mt-2 text-xs text-muted">{dirty ? "You have unsaved changes. Save the draft before changing its status." : p.status === "draft" ? "Nothing is sent from here. Download the PDF, send it yourself, then mark it sent." : locked ? "Only drafts can be edited. Set it back to draft to make changes." : ""}</p>
        </Card>
      )}

      <fieldset disabled={locked} className="space-y-4">
        <Card>
          <SectionTitle>Recipient and terms</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lead">{(i) => <Select id={i} value={draft.lead_id} onChange={set("lead_id")}><option value="">None</option>{(leads.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` (${l.company})` : ""}</option>)}</Select>}</Field>
            <Field label="Client">{(i) => <Select id={i} value={draft.client_id} onChange={set("client_id")}><option value="">None</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Field label="Title *">{(i) => <Input id={i} value={draft.title} onChange={set("title")} placeholder="SEO growth plan" />}</Field>
            <Field label="Valid until">{(i) => <Input id={i} type="date" value={draft.valid_until} onChange={set("valid_until")} />}</Field>
            <div className="sm:col-span-2"><Field label="Project description">{(i) => <Textarea id={i} value={draft.description} onChange={set("description")} />}</Field></div>
            <Field label="Deliverables">{(i) => <Textarea id={i} value={draft.deliverables} onChange={set("deliverables")} />}</Field>
            <Field label="Timeline">{(i) => <Textarea id={i} value={draft.timeline} onChange={set("timeline")} />}</Field>
            <div className="sm:col-span-2"><Field label="Payment terms">{(i) => <Textarea id={i} value={draft.payment_terms} onChange={set("payment_terms")} placeholder="e.g. 50% upfront, balance on completion" />}</Field></div>
          </div>
        </Card>

        <Card>
          <SectionTitle>Line items</SectionTitle>
          {!draft.items.length && <p className="mb-3 text-sm text-muted">Add a package from your pricing, or a custom line.</p>}
          <div className="space-y-2">
            {draft.items.map((it, n) => (
              <div key={n} className="grid grid-cols-[1fr_5rem_7rem_auto] items-end gap-2 max-sm:grid-cols-2">
                <Field label={n === 0 ? "Description" : ""}>{(i) => <Input id={i} aria-label={`Line ${n + 1} description`} value={it.description} onChange={(e) => setItem(n, { description: e.target.value })} />}</Field>
                <Field label={n === 0 ? "Qty" : ""}>{(i) => <Input id={i} aria-label={`Line ${n + 1} quantity`} type="number" min={0} step="any" value={it.quantity} onChange={(e) => setItem(n, { quantity: Number(e.target.value) })} />}</Field>
                <Field label={n === 0 ? "Unit price" : ""}>{(i) => <Input id={i} aria-label={`Line ${n + 1} unit price`} type="number" min={0} step="any" value={it.unit_price} onChange={(e) => setItem(n, { unit_price: Number(e.target.value) })} />}</Field>
                <Button type="button" variant="ghost" aria-label={`Remove line ${n + 1}`} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== n) })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Select aria-label="Add from package" className="!w-auto" value="" onChange={(e) => {
              const pkg = packages.data?.find((x) => x.id === Number(e.target.value));
              if (pkg) setDraft({ ...draft, items: [...draft.items, { package_id: pkg.id, description: pkg.name, quantity: 1, unit_price: pkg.price }] });
            }}>
              <option value="">Add from package…</option>
              {(packages.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.price, currency)}{x.billing === "monthly" ? "/mo" : ""}</option>)}
            </Select>
            <Button type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { package_id: null, description: "", quantity: 1, unit_price: 0 }] })}><Plus className="size-4" />Custom line</Button>
          </div>
          <dl className="mt-5 ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="num">{money(totals.subtotal, currency)}</dd></div>
            <div className="flex items-center justify-between gap-2"><dt className="text-muted"><label htmlFor="discount">Discount %</label></dt><dd><Input id="discount" className="!w-20 !py-1 text-right" type="number" min={0} max={100} step="any" value={draft.discount_percent} onChange={set("discount_percent")} /></dd></div>
            {totals.discount > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="num">−{money(totals.discount, currency)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-semibold"><dt>Total</dt><dd className="num">{money(isNew || !locked ? totals.total : p!.total, currency)}</dd></div>
          </dl>
        </Card>
      </fieldset>

      {error && <p role="alert" className="mt-4 rounded-lg bg-dangersoft px-3 py-2 text-sm text-danger">{error}</p>}
      {!locked && <div className="mt-4 flex justify-end gap-2"><Link to="/proposals"><Button>Cancel</Button></Link><Button variant="primary" busy={save.isPending} onClick={submit}>{isNew ? "Create proposal" : "Save draft"}</Button></div>}
      {del && <Confirm title="Delete this proposal?" confirmLabel="Delete proposal" busy={remove.isPending} onCancel={() => setDel(false)} onConfirm={() => remove.mutate()} body="The proposal and its line items are permanently deleted." />}
    </>
  );
}
