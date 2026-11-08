import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { PROPOSAL_STATUSES, cap, money, useCurrency } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { Proposal } from "../lib/types";

export const proposalTone = (s: string) => (({ accepted: "ok", sent: "info", rejected: "danger", expired: "warn", draft: "muted" }) as const)[s as "draft"] ?? "muted";

export default function ProposalsPage() {
  const currency = useCurrency();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["proposals", status], queryFn: () => api<Proposal[]>(`/proposals${status ? `?status=${status}` : ""}`) });
  const New = <Link to="/proposals/new" className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accentfg"><Plus className="size-4" />New proposal</Link>;
  return (
    <>
      <PageHeader title="Proposals" subtitle="Build a quote, export the PDF, and track where each proposal stands. Nothing is emailed automatically."
        actions={<><Select aria-label="Filter by status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{PROPOSAL_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>{New}</>} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <EmptyState icon={<FileText className="size-6" />} title={status ? "No proposals with this status" : "No proposals yet"} body={status ? undefined : "Create a proposal for a lead or client from your pricing packages or custom line items."} action={status ? undefined : New} />
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Proposal", "For", "Status", "Total", "Valid until", "Created"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data.map((p) => (
                  <tr key={p.id} className="border-t border-line hover:bg-surface2">
                    <td className="px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/proposals/${p.id}`}>{p.title}</Link></td>
                    <td className="px-4">{p.recipient_name || "—"}</td><td className="px-4"><Badge tone={proposalTone(p.status)}>{cap(p.status)}</Badge></td>
                    <td className="num px-4 font-medium">{money(p.total, currency)}</td><td className="px-4 text-muted">{fmtDate(p.valid_until)}</td><td className="px-4 text-muted">{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
