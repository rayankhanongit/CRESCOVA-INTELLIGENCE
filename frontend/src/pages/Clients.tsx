import { useQuery } from "@tanstack/react-query";
import { Plus, UserCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import FormModal, { type FieldDef } from "../components/FormModal";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { CLIENT_STATUSES, cap, money, useAction, useCurrency } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Client } from "../lib/types";

export const clientTone = (s: string) => (({ active: "ok", onboarding: "info", paused: "warn", cancelled: "danger", completed: "muted" }) as const)[s as "active"] ?? "muted";

export const CLIENT_FIELDS: FieldDef[] = [
  { key: "name", label: "Client name", required: true },
  { key: "company", label: "Company" },
  { key: "email", label: "Email", kind: "email" },
  { key: "phone", label: "Phone", kind: "tel" },
  { key: "website", label: "Website", kind: "url", placeholder: "example.com" },
  { key: "status", label: "Status", kind: "select", options: CLIENT_STATUSES.map((s) => [s, cap(s)]) },
  { key: "contract_start", label: "Contract start", kind: "date" },
  { key: "contract_end", label: "Contract end", kind: "date" },
  { key: "monthly_value", label: "Monthly value", kind: "number", step: "any", hint: "Recurring fee in your agency currency." },
  { key: "services", label: "Services purchased", kind: "textarea" },
  { key: "notes", label: "Notes", kind: "textarea" },
];

export default function ClientsPage() {
  const currency = useCurrency();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ ...(q && { q }), ...(status && { status }) }).toString();
  const clients = useQuery({ queryKey: ["clients", params], queryFn: () => api<Client[]>(`/clients${params ? `?${params}` : ""}`) });
  const create = useAction((p: Record<string, unknown>) => api<Client>("/clients", { method: "POST", body: p }), { invalidate: ["clients", "overview"], ok: "Client added" });

  return (
    <>
      <PageHeader title="Clients" subtitle="Active relationships, contracts and onboarding."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />Add client</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search clients" placeholder="Search name, company, email…" className="!w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Filter by status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>
      </div>
      {clients.isLoading ? <Spinner /> : clients.error ? <ErrorState error={clients.error} retry={clients.refetch} /> : !clients.data?.length ? (
        <EmptyState icon={<UserCheck className="size-6" />} title={params ? "No clients match" : "No clients yet"} body={params ? undefined : "Convert a qualified lead, or add a client directly."}
          action={params ? undefined : <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />Add client</Button>} />
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Client", "Status", "Monthly value", "Contract", "Onboarding"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {clients.data.map((c) => (
                  <tr key={c.id} className="border-t border-line hover:bg-surface2">
                    <td className="px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/clients/${c.id}`}>{c.name}</Link><div className="text-xs text-muted">{c.company}</div></td>
                    <td className="px-4"><Badge tone={clientTone(c.status)}>{cap(c.status)}</Badge></td>
                    <td className="num px-4">{c.monthly_value ? money(c.monthly_value, currency) : "—"}</td>
                    <td className="px-4 text-muted">{c.contract_start ? `${fmtDate(c.contract_start)} → ${fmtDate(c.contract_end)}` : "—"}</td>
                    <td className="px-4">{c.onboarding_total ? <span className="num">{c.onboarding_done}/{c.onboarding_total}</span> : <span className="text-muted">Not started</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {adding && <FormModal title="Add client" fields={CLIENT_FIELDS} initial={{ status: "onboarding" }} submitLabel="Add client" onSubmit={(p) => create.mutateAsync(p)} onClose={() => setAdding(false)} />}
    </>
  );
}
