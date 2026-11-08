import { useQuery } from "@tanstack/react-query";
import { Globe, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { LEAD_LABEL, money } from "../lib/crm";
import { fmtDate, scoreTone } from "../lib/format";
import type { Business, Overview } from "../lib/types";
import { Card, EmptyState, ErrorState, PageHeader, SectionTitle, Spinner, Stat, StatusBadge } from "../components/ui";

const PALETTE = ["var(--accent)", "var(--info)", "var(--warn)", "var(--danger)", "var(--ok)"];

/** Pivot [{date, website, score}] into one row per date with a column per website. */
export function pivotTrend(points: Overview["score_trend"]) {
  const rows = new Map<string, Record<string, number | string>>();
  const sites = new Set<string>();
  for (const p of points) {
    sites.add(p.website);
    rows.set(p.date, { ...(rows.get(p.date) ?? { date: p.date }), [p.website]: p.score });
  }
  return { data: [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), sites: [...sites] };
}

const axis = { stroke: "var(--muted)", fontSize: 12 } as const;
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)" } };

export function BusinessSection({ b }: { b: Business }) {
  const m = (v: number) => <span className="text-2xl">{money(v, b.currency)}</span>;  // long currency strings need a smaller size to fit the card
  const empty = b.leads_total === 0 && b.clients_total === 0;
  return (
    <section className="mt-8" aria-label="Agency business">
      <h2 className="mb-3 font-display text-lg font-semibold">Agency business</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total leads" value={b.leads_total} />
        <Stat label="New leads" value={b.leads_new} />
        <Stat label="Qualified leads" value={b.leads_qualified} />
        <Stat label="Conversion rate" value={b.conversion_rate == null ? "—" : `${b.conversion_rate}%`} hint="Leads converted to clients" />
        <Stat label="Active clients" value={b.clients_active} hint={`${b.clients_total} in total`} />
        <Stat label="Proposals sent" value={b.proposals_sent} hint={`${b.proposals_accepted} accepted`} />
        <Stat label="Monthly recurring value" value={m(b.monthly_recurring_value)} hint="Active clients' monthly fees" />
        <Stat label="Accepted proposals" value={m(b.accepted_proposal_value)} hint="Total value after discounts" />
      </div>
      <p className="mt-2 text-xs text-muted">Revenue figures come from client fees and accepted proposals you entered. Invoices and payments are not tracked yet, so there is no outstanding-payments figure.</p>

      {empty ? (
        <Card className="mt-4"><p className="text-sm text-muted">No leads or clients yet. <Link className="text-accent hover:underline" to="/leads">Add your first lead</Link> to see the funnel and trends.</p></Card>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card>
            <SectionTitle>Lead funnel</SectionTitle>
            <div className="h-56" role="img" aria-label="Bar chart of leads at each pipeline stage">
              <ResponsiveContainer><BarChart data={b.funnel.map((f) => ({ ...f, stage: LEAD_LABEL[f.stage] }))} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} /><XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="stage" width={90} {...axis} /><Tooltip {...tip} />
                <Bar dataKey="leads" fill="var(--accent)" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <SectionTitle>Lead acquisition</SectionTitle>
            <div className="h-56" role="img" aria-label="Bar chart of new leads per month">
              <ResponsiveContainer><BarChart data={b.leads_by_month}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="month" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Bar dataKey="leads" fill="var(--info)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <SectionTitle>Client growth</SectionTitle>
            <div className="h-56" role="img" aria-label="Line chart of cumulative clients per month">
              <ResponsiveContainer><LineChart data={b.client_growth}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="month" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Line type="monotone" dataKey="clients" stroke="var(--ok)" strokeWidth={2.5} dot /></LineChart></ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      <Card className="mt-4">
        <SectionTitle>Needs attention</SectionTitle>
        {!b.attention.length ? <p className="text-sm text-muted">No overdue follow-ups and no tasks due in the next two days.</p> : (
          <ul className="divide-y divide-line text-sm">
            {b.attention.map((a) => (
              <li key={`${a.kind}${a.id}`} className="flex items-center justify-between gap-3 py-2">
                <Link className="font-medium hover:text-accent" to={a.kind === "task" ? "/tasks" : `/leads/${a.id}`}>{a.title}</Link>
                <span className={a.overdue ? "text-danger" : "text-muted"}>{a.overdue ? "Overdue · " : "Due "}{fmtDate(a.due)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

export default function OverviewPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/dashboard/overview") });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const { seo } = data;
  const trend = pivotTrend(data.score_trend);

  return (
    <>
      <PageHeader title="Overview" subtitle="Live figures computed from your stored audits. Nothing here is simulated." />

      {seo.websites === 0 ? (
        <EmptyState icon={<Globe className="size-6" />} title="Add your first website"
          body="Add a client site, run an audit, and this dashboard fills with real scores, issues and trends."
          action={<Link to="/websites"><span className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accentfg"><Plus className="size-4" />Add website</span></Link>} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Websites" value={seo.websites} />
            <Stat label="Audits completed" value={seo.audits_total} />
            <Stat label="Avg. SEO health" value={seo.average_score ?? "—"} tone={scoreTone(seo.average_score)} hint="Latest full audit per site" />
            <Stat label="Critical issues" value={seo.critical_issues} tone={seo.critical_issues ? "danger" : "ok"} hint="Open, latest audits" />
            <Stat label="Warnings" value={seo.warnings} tone={seo.warnings ? "warn" : "ok"} />
            <Stat label="Issues resolved" value={seo.improvements_completed} tone="ok" hint="Fixed between last two audits" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>SEO health score over time</SectionTitle>
              {trend.data.length < 2 ? (
                <p className="py-12 text-center text-sm text-muted">Run at least two full-site audits to see a trend.</p>
              ) : (
                <div className="h-64" role="img" aria-label="Line chart of SEO health score per audit date">
                  <ResponsiveContainer>
                    <LineChart data={trend.data}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="date" {...axis} /><YAxis domain={[0, 100]} {...axis} /><Tooltip {...tip} /><Legend />
                      {trend.sites.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot connectNulls />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <SectionTitle>Audit activity</SectionTitle>
              <div className="h-64" role="img" aria-label="Bar chart of audits run per day">
                <ResponsiveContainer>
                  <BarChart data={data.audit_activity}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="date" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} />
                    <Bar dataKey="audits" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="mt-4" pad={false}>
            <div className="p-5 pb-2"><SectionTitle>Recent audits</SectionTitle></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="px-5 py-2 font-medium">Website</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Score</th><th className="px-3 font-medium">Pages</th><th className="px-5 font-medium">Date</th></tr></thead>
                <tbody>
                  {data.recent_audits.map((a) => (
                    <tr key={a.id} className="border-t border-line hover:bg-surface2">
                      <td className="px-5 py-2.5"><Link className="font-medium text-accent hover:underline" to={`/audits/${a.id}`}>{a.website_name}</Link></td>
                      <td className="px-3"><StatusBadge status={a.status} /></td>
                      <td className="num px-3">{a.score ?? "—"}</td><td className="num px-3">{a.pages_crawled}</td><td className="px-5 text-muted">{fmtDate(a.created_at, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <BusinessSection b={data.business} />
    </>
  );
}
