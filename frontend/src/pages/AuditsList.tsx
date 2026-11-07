import { useQuery } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDate, fmtDuration } from "../lib/format";
import type { Audit } from "../lib/types";
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from "../components/ui";

export default function AuditsList() {
  const q = useQuery({
    queryKey: ["all-audits"], queryFn: () => api<Audit[]>("/audits?limit=200"),
    refetchInterval: (s) => (s.state.data?.some((a) => a.status === "queued" || a.status === "running") ? 2000 : false),
  });
  return (
    <>
      <PageHeader title="SEO Audits" subtitle="Every audit across all websites. Start new audits from a website's page." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <EmptyState icon={<ScanSearch className="size-6" />} title="No audits yet" body="Open a website and press Start audit." action={<Link className="text-sm font-medium text-accent hover:underline" to="/websites">Go to websites</Link>} />
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{["Audit", "Website", "Date", "Scope", "Status", "Score", "Pages", "Critical", "Warnings", "Duration"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id} className="border-t border-line hover:bg-surface2">
                    <td className="px-4 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/audits/${a.id}`}>#{a.id}</Link></td>
                    <td className="px-4"><Link className="hover:text-accent" to={`/websites/${a.website_id}`}>{a.website_name}</Link></td>
                    <td className="px-4 text-muted">{fmtDate(a.created_at, true)}</td><td className="px-4">{a.mode === "site" ? "Whole site" : "Single page"}</td>
                    <td className="px-4"><StatusBadge status={a.status} /></td><td className="num px-4 font-medium">{a.score ?? "—"}</td><td className="num px-4">{a.pages_crawled}</td>
                    <td className="num px-4 text-danger">{a.critical_count}</td><td className="num px-4 text-warn">{a.warning_count}</td><td className="num px-4 text-muted">{fmtDuration(a.duration_ms)}</td>
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
