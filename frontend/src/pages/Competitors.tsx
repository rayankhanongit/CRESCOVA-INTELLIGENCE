import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, Plus, Sparkles, Swords, Trash2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AiBadge, AiNotice, useAi } from "../components/Ai";
import FormModal from "../components/FormModal";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SectionTitle, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAction } from "../lib/crm";
import { fmtDate } from "../lib/format";
import type { CompetitiveView, Competitor, SiteSummary, Website } from "../lib/types";

const COLORS = ["var(--accent)", "var(--info)", "var(--warn)", "var(--danger)", "var(--ok)"];
const METRICS: { key: keyof SiteSummary; label: string }[] = [
  { key: "pct_with_title", label: "% pages with title" }, { key: "pct_with_description", label: "% with meta description" },
  { key: "pct_with_h1", label: "% with H1" }, { key: "pct_with_schema", label: "% with structured data" },
];
const yes = (v: boolean) => (v ? "Yes" : "No");

function Insights({ c, canRun }: { c: Competitor; canRun: boolean }) {
  const ai = useAi();
  const run = useAction(() => api(`/competitors/${c.id}/insights`, { method: "POST" }), { invalidate: ["competitors", "usage"], ok: "Insights generated" });
  const i = c.insights;
  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-sm">
      <div className="mb-2 flex items-center gap-2"><AiBadge label="AI interpretation" /><span className="text-xs text-muted">Strategic reading of the observed facts. Not measured data.</span></div>
      {!i ? (
        <Button size="sm" busy={run.isPending} disabled={!ai.configured || !canRun} title={!ai.configured ? "AI is not configured" : !canRun ? "Run a full audit of your own site first" : undefined} onClick={() => run.mutate()}><Sparkles className="size-3.5" />Generate insights</Button>
      ) : (
        <div className="space-y-2">
          {([["Observed in the data", i.observed], ["Interpretation", i.interpretation], ["Opportunities", i.opportunities]] as const).map(([h, items]) => items.length > 0 && (
            <div key={h}><div className="text-xs font-semibold uppercase tracking-wide text-muted">{h}</div><ul className="list-disc pl-5">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>
          ))}
          <p className="text-xs text-muted">{i.provider} · {i.model} · {fmtDate(i.generated_at, true)}</p>
        </div>
      )}
    </div>
  );
}

export default function CompetitorsPage() {
  const sites = useQuery({ queryKey: ["websites"], queryFn: () => api<Website[]>("/websites") });
  const [pick, setPick] = useState<number | null>(null);
  const siteId = pick ?? sites.data?.[0]?.id ?? null;
  const [adding, setAdding] = useState(false);
  const comps = useQuery({
    queryKey: ["competitors", siteId], enabled: siteId != null, queryFn: () => api<Competitor[]>(`/websites/${siteId}/competitors`),
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === "running") ? 2500 : false),
  });
  const view = useQuery({ queryKey: ["competitors", "view", siteId, comps.data?.map((c) => `${c.id}${c.status}${c.last_analysed_at}`).join()], enabled: siteId != null, queryFn: () => api<CompetitiveView>(`/websites/${siteId}/comparison`) });
  const add = useAction((b: Record<string, unknown>) => api(`/websites/${siteId}/competitors`, { method: "POST", body: b }), { invalidate: ["competitors"], ok: "Competitor added" });
  const analyse = useAction((c: Competitor) => api(`/competitors/${c.id}/analyse`, { method: "POST" }), { invalidate: ["competitors"], ok: "Analysis started" });
  const remove = useAction((c: Competitor) => api(`/competitors/${c.id}`, { method: "DELETE" }), { invalidate: ["competitors"], ok: "Competitor removed" });

  if (sites.isLoading) return <Spinner />;
  if (!sites.data?.length) return <><PageHeader title="Competitor Analysis" /><EmptyState icon={<Swords className="size-6" />} title="Add a website first" body="Competitors are compared against one of your managed websites." /></>;
  const v = view.data;
  const chart = METRICS.map((m) => ({ metric: m.label, ...(v?.own ? { "Your site": v.own[m.key] as number } : {}), ...Object.fromEntries((v?.competitors ?? []).map((c) => [c.name, c.analysis[m.key] as number])) }));
  const series = ["Your site", ...(v?.competitors.map((c) => c.name) ?? [])].filter((s) => s !== "Your site" || v?.own);

  return (
    <>
      <PageHeader title="Competitor Analysis" subtitle="Compares publicly visible pages only. We have no access to competitors' analytics, backlinks or rankings."
        actions={<><Select aria-label="Website" className="!w-auto" value={siteId ?? ""} onChange={(e) => setPick(Number(e.target.value))}>{sites.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />Add competitor</Button></>} />
      <AiNotice />
      {comps.isLoading ? <Spinner /> : comps.error ? <ErrorState error={comps.error} retry={comps.refetch} /> : !comps.data?.length ? (
        <EmptyState icon={<Swords className="size-6" />} title="No competitors yet" body="Add a competitor's website. We read up to 10 public pages, respecting robots.txt." action={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />Add competitor</Button>} />
      ) : (
        <div className="space-y-4">
          {comps.data.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1"><div className="font-display text-lg font-semibold">{c.name}</div><div className="truncate text-sm text-muted">{c.url}</div></div>
                {c.status === "running" ? <Badge tone="info"><Loader2 className="mr-1 size-3 animate-spin" aria-hidden />Analysing</Badge> : c.last_analysed_at ? <span className="text-xs text-muted">Analysed {fmtDate(c.last_analysed_at, true)}</span> : <Badge>Not analysed</Badge>}
                <Button size="sm" variant="primary" busy={analyse.isPending} disabled={c.status === "running"} onClick={() => analyse.mutate(c)}><Play className="size-3.5" />{c.last_analysed_at ? "Re-analyse" : "Analyse"}</Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => remove.mutate(c)}><Trash2 className="size-3.5" /></Button>
              </div>
              {c.error && <p role="alert" className="mt-2 text-sm text-warn">{c.error}</p>}
              {c.analysis && <Insights c={c} canRun={!!v?.own} />}
            </Card>
          ))}
        </div>
      )}

      {v && v.competitors.length > 0 && (
        <div className="mt-6 space-y-4">
          <SectionTitle>Observed comparison</SectionTitle>
          {!v.own && <p className="text-sm text-muted">Run a full-site audit of {v.website.name} to include your own site in this comparison.</p>}
          <Card>
            <div className="h-64" role="img" aria-label="Bar chart comparing the share of pages with key SEO elements">
              <ResponsiveContainer><BarChart data={chart}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="metric" stroke="var(--muted)" fontSize={11} /><YAxis domain={[0, 100]} stroke="var(--muted)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12 }} /><Legend />
                {series.map((s, i) => <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />)}</BarChart></ResponsiveContainer>
            </div>
          </Card>
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Measure</th>{v.own && <th className="px-4 font-medium">Your site</th>}{v.competitors.map((c) => <th key={c.id} className="px-4 font-medium">{c.name}</th>)}</tr></thead>
                <tbody>
                  {([["Pages analysed", (s: SiteSummary) => s.pages_analysed], ["Average words per page", (s: SiteSummary) => s.avg_word_count], ["HTTPS", (s: SiteSummary) => yes(s.site.https)], ["robots.txt", (s: SiteSummary) => yes(s.site.robots)],
                    ["XML sitemap", (s: SiteSummary) => (s.site.sitemap ? `${s.site.sitemap_urls} URLs` : "No")], ["Structured data types", (s: SiteSummary) => Object.keys(s.schema_types).join(", ") || "None"]] as const).map(([label, f]) => (
                    <tr key={label} className="border-t border-line"><td className="px-4 py-2.5 text-muted">{label}</td>{v.own && <td className="num px-4">{f(v.own)}</td>}{v.competitors.map((c) => <td key={c.id} className="num px-4">{f(c.analysis)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {v.own && v.competitors.map((c) => (
            <Card key={c.id}>
              <SectionTitle aside={<Badge>Observed</Badge>}>Terms {c.name} uses that your pages don't</SectionTitle>
              {c.content_gaps.length ? <div className="flex flex-wrap gap-1.5">{c.content_gaps.map((g) => <Badge key={g} tone="info">{g}</Badge>)}</div> : <p className="text-sm text-muted">No gaps found in titles and headings.</p>}
              <p className="mt-2 text-xs text-muted">Words from page titles, H1s and H2s on up to 10 crawled pages each. A gap is a prompt to consider a topic, not proof of a ranking advantage.</p>
            </Card>
          ))}
          <p className="text-xs text-muted">{v.note}</p>
        </div>
      )}
      {adding && <FormModal title="Add competitor" submitLabel="Add competitor" onClose={() => setAdding(false)} onSubmit={(p) => add.mutateAsync(p)}
        fields={[{ key: "name", label: "Name", required: true }, { key: "url", label: "Website URL", required: true, kind: "url", hint: "Public sites only. Private and internal addresses are rejected." }]} />}
    </>
  );
}
