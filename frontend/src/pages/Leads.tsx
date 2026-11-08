import { useQuery } from "@tanstack/react-query";
import { Columns3, Plus, Table2, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import FormModal, { type FieldDef } from "../components/FormModal";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { LEAD_LABEL, LEAD_STAGES, PRIORITIES, cap, money, todayStr, useAction, useCurrency } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Lead, LeadStatus } from "../lib/types";

const opt = (xs: string[], blank: string): [string, string][] => [["", blank], ...xs.map((x): [string, string] => [x, cap(x)])];

export const LEAD_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "company", label: "Company" },
  { key: "email", label: "Email", kind: "email" },
  { key: "phone", label: "Phone", kind: "tel" },
  { key: "website", label: "Website", kind: "url", placeholder: "example.com" },
  { key: "service_interest", label: "Service interested in", placeholder: "SEO, social media, new website…" },
  { key: "budget", label: "Budget", kind: "number", step: "any", hint: "In your agency currency. Leave blank if unknown." },
  { key: "source", label: "Lead source", placeholder: "Referral, website form, LinkedIn…" },
  { key: "priority", label: "Priority", kind: "select", options: opt(PRIORITIES, "Not set") },
  { key: "next_follow_up", label: "Next follow-up", kind: "date" },
  { key: "notes", label: "Notes", kind: "textarea" },
];

const dueTone = (d: string | null) => (d && d < todayStr() ? "danger" : "muted") as "danger" | "muted";

function LeadCard({ lead, onMove, currency }: { lead: Lead; onMove: (id: number, s: LeadStatus) => void; currency: string }) {
  return (
    <article draggable={lead.status !== "converted"} onDragStart={(e) => e.dataTransfer.setData("text/plain", String(lead.id))}
      className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <Link to={`/leads/${lead.id}`} className="block truncate text-sm font-semibold hover:text-accent">{lead.name}</Link>
      {lead.company && <div className="truncate text-xs text-muted">{lead.company}</div>}
      <div className="mt-2 flex flex-wrap gap-1">
        {lead.priority && <Badge tone={lead.priority === "high" ? "danger" : lead.priority === "medium" ? "warn" : "muted"}>{cap(lead.priority)}</Badge>}
        {lead.budget != null && <Badge>{money(lead.budget, currency)}</Badge>}
        {lead.next_follow_up && <Badge tone={dueTone(lead.next_follow_up)}>Follow-up {fmtDate(lead.next_follow_up)}</Badge>}
      </div>
      {lead.service_interest && <div className="mt-2 truncate text-xs text-muted">{lead.service_interest}</div>}
      <Select aria-label={`Move ${lead.name}`} className="mt-2 !py-1 text-xs" value={lead.status} onChange={(e) => onMove(lead.id, e.target.value as LeadStatus)}>
        {LEAD_STAGES.map((s) => <option key={s.key} value={s.key} disabled={s.key === "converted" && lead.status !== "converted"}>{s.label}</option>)}
      </Select>
    </article>
  );
}

export default function LeadsPage() {
  const currency = useCurrency();
  const toast = useToast();
  const [view, setView] = useState<"board" | "table">("board");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ ...(q && { q }), ...(priority && { priority }), ...(source && { source }) }).toString();
  const leads = useQuery({ queryKey: ["leads", params], queryFn: () => api<Lead[]>(`/leads${params ? `?${params}` : ""}`) });
  const create = useAction((p: Record<string, unknown>) => api<Lead>("/leads", { method: "POST", body: p }), { invalidate: ["leads", "overview"], ok: "Lead added" });
  const move = useAction(({ id, status }: { id: number; status: LeadStatus }) => api(`/leads/${id}`, { method: "PATCH", body: { status } }), { invalidate: ["leads", "lead", "overview"] });
  const onMove = (id: number, s: LeadStatus) => { if (s === "converted") return toast("error", "Use “Convert to client” on the lead page."); move.mutate({ id, status: s }); };

  const sources = [...new Set((leads.data ?? []).map((l) => l.source).filter(Boolean))];
  const shown = (leads.data ?? []).filter((l) => !status || l.status === status);

  return (
    <>
      <PageHeader title="Leads CRM" subtitle="Capture, qualify and move leads through your pipeline."
        actions={<>
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="View">
            {([["board", Columns3, "Board"], ["table", Table2, "Table"]] as const).map(([k, Icon, label]) => (
              <button key={k} onClick={() => setView(k)} aria-pressed={view === k} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === k ? "bg-accentsoft text-accent" : "text-muted"}`}><Icon className="size-3.5" />{label}</button>
            ))}
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />Add lead</Button>
        </>} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search leads" placeholder="Search name, company, email…" className="!w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Filter by priority" className="!w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>{opt(PRIORITIES, "Any priority").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Select aria-label="Filter by source" className="!w-auto" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Any source</option>{sources.map((s) => <option key={s}>{s}</option>)}</Select>
        {view === "table" && <Select aria-label="Filter by status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>}
      </div>

      {leads.isLoading ? <Spinner /> : leads.error ? <ErrorState error={leads.error} retry={leads.refetch} /> : !leads.data?.length && !params ? (
        <EmptyState icon={<Users className="size-6" />} title="No leads yet" body="Add your first lead to start tracking your pipeline." action={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />Add lead</Button>} />
      ) : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {LEAD_STAGES.map((stage) => {
            const col = (leads.data ?? []).filter((l) => l.status === stage.key);
            return (
              <section key={stage.key} aria-label={stage.label} className="w-64 shrink-0 rounded-2xl bg-surface2 p-2"
                onDragOver={(e) => stage.key !== "converted" && e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")); if (id && stage.key !== "converted") onMove(id, stage.key); }}>
                <h2 className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{stage.label}<span className="num rounded bg-surface px-1.5 py-0.5">{col.length}</span></h2>
                <div className="space-y-2">{col.map((l) => <LeadCard key={l.id} lead={l} onMove={onMove} currency={currency} />)}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Name", "Company", "Service", "Budget", "Source", "Status", "Priority", "Next follow-up", "Added"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} className="border-t border-line hover:bg-surface2">
                    <td className="px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/leads/${l.id}`}>{l.name}</Link></td>
                    <td className="px-4">{l.company || "—"}</td><td className="max-w-48 truncate px-4">{l.service_interest || "—"}</td>
                    <td className="num px-4">{l.budget != null ? money(l.budget, currency) : "—"}</td><td className="px-4">{l.source || "—"}</td>
                    <td className="px-4"><Badge tone={l.status === "converted" ? "ok" : l.status === "lost" ? "danger" : "info"}>{LEAD_LABEL[l.status]}</Badge></td>
                    <td className="px-4">{l.priority ? cap(l.priority) : "—"}</td>
                    <td className={`px-4 ${dueTone(l.next_follow_up) === "danger" ? "text-danger" : ""}`}>{fmtDate(l.next_follow_up)}</td><td className="px-4 text-muted">{fmtDate(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <p className="p-6 text-center text-sm text-muted">No leads match these filters.</p>}
          </div>
        </Card>
      )}
      {adding && <FormModal title="Add lead" fields={LEAD_FIELDS} submitLabel="Add lead" onSubmit={(p) => create.mutateAsync(p)} onClose={() => setAdding(false)} />}
    </>
  );
}
