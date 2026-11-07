import { useQuery } from "@tanstack/react-query";
import { History as HistoryIcon, MoveRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { CATEGORY_LABEL, fmtDate } from "../lib/format";
import type { Audit, CategoryKey, Comparison, Website } from "../lib/types";
import { FindingRow } from "../components/Findings";
import { Badge, Card, EmptyState, ErrorState, PageHeader, SectionTitle, Select, Spinner, Stat } from "../components/ui";

const COLORS = ["var(--accent)", "var(--info)", "var(--warn)", "var(--danger)", "var(--ok)", "var(--muted)"];
const axis = { stroke: "var(--muted)", fontSize: 12 } as const;

function Delta({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-muted">n/a</span>;
  return <span className={`num font-medium ${v > 0 ? "text-ok" : v < 0 ? "text-danger" : "text-muted"}`}>{v > 0 ? "+" : ""}{v}</span>;
}

function FindingGroup({ title, tone, items }: { title: string; tone: "ok" | "danger" | "muted"; items: Comparison["new"] }) {
  const [show, setShow] = useState(false);
  return (
    <Card pad={false}>
      <button className="flex w-full items-center justify-between p-4 text-left" onClick={() => setShow(!show)} aria-expanded={show}>
        <span className="flex items-center gap-2 font-medium">{title} <Badge tone={tone}>{items.length}</Badge></span>
        <span className="text-xs text-muted">{show ? "Hide" : "Show"}</span>
      </button>
      {show && (items.length ? <ul className="border-t border-line">{items.map((f) => <FindingRow key={`${f.check_id}|${f.url}`} f={f} />)}</ul> : <p className="border-t border-line p-4 text-sm text-muted">None.</p>)}
    </Card>
  );
}

export default function HistoryPage() {
  const sites = useQuery({ queryKey: ["websites"], queryFn: () => api<Website[]>("/websites") });
  const [siteId, setSiteId] = useState<number | null>(null);
  const active = siteId ?? sites.data?.[0]?.id ?? null;
  const audits = useQuery({ queryKey: ["audits", active], enabled: active != null, queryFn: () => api<Audit[]>(`/websites/${active}/audits`) });
  const full = useMemo(() => (audits.data ?? []).filter((a) => a.status === "completed").sort((a, b) => a.created_at.localeCompare(b.created_at)), [audits.data]);
  const [base, setBase] = useState<number | "">("");
  const [target, setTarget] = useState<number | "">("");
  const baseId = base || full.at(-2)?.id, targetId = target || full.at(-1)?.id;
  const cmp = useQuery({
    queryKey: ["compare", baseId, targetId], enabled: !!baseId && !!targetId && baseId !== targetId,
    queryFn: () => api<Comparison>(`/audits/compare?base=${baseId}&target=${targetId}`),
  });

  const chart = full.map((a) => ({ label: fmtDate(a.created_at), Overall: a.mode === "site" ? a.score : null, ...Object.fromEntries(Object.entries(a.category_scores).map(([k, v]) => [CATEGORY_LABEL[k as CategoryKey], a.mode === "site" ? v : null])) }));
  const [showCats, setShowCats] = useState(false);

  if (sites.isLoading) return <Spinner />;
  if (sites.error) return <ErrorState error={sites.error} />;
  if (!sites.data?.length) return <><PageHeader title="SEO History" /><EmptyState icon={<HistoryIcon className="size-6" />} title="No websites yet" body="Add a website and run audits to build a history." action={<Link className="text-sm font-medium text-accent hover:underline" to="/websites">Go to websites</Link>} /></>;

  const label = (a: Audit) => `#${a.id} · ${fmtDate(a.created_at)} · ${a.score ?? "n/a"}${a.mode === "url" ? " (single page)" : ""}`;
  const keys = chart.length ? Object.keys(chart[0]).filter((k) => k !== "label" && (showCats || k === "Overall")) : [];

  return (
    <>
      <PageHeader title="SEO History" subtitle="Track a website's score over time and compare any two audits."
        actions={<Select aria-label="Website" className="!w-auto" value={active ?? ""} onChange={(e) => { setSiteId(Number(e.target.value)); setBase(""); setTarget(""); }}>{sites.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>} />

      {audits.isLoading ? <Spinner /> : full.length === 0 ? <EmptyState title="No completed audits" body="Run an audit on this website to start its history." /> : (
        <>
          <Card>
            <SectionTitle aside={<label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showCats} onChange={(e) => setShowCats(e.target.checked)} />Show categories</label>}>Score over time</SectionTitle>
            {full.length < 2 ? <p className="py-10 text-center text-sm text-muted">One audit so far. Run another to see a trend.</p> : (
              <div className="h-72" role="img" aria-label="Line chart of SEO score by audit date">
                <ResponsiveContainer>
                  <LineChart data={chart}>
                    <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis domain={[0, 100]} {...axis} />
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12 }} /><Legend />
                    {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={k === "Overall" ? 3 : 1.75} dot connectNulls />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="mt-6">
            <SectionTitle>Compare two audits</SectionTitle>
            {full.length < 2 ? <p className="text-sm text-muted">You need at least two completed audits to compare.</p> : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Select aria-label="Earlier audit" className="!w-auto" value={baseId ?? ""} onChange={(e) => setBase(Number(e.target.value))}>{full.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}</Select>
                  <MoveRight className="size-4 text-muted" aria-hidden />
                  <Select aria-label="Later audit" className="!w-auto" value={targetId ?? ""} onChange={(e) => setTarget(Number(e.target.value))}>{full.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}</Select>
                </div>
                {baseId === targetId ? <p className="text-sm text-muted">Pick two different audits.</p> : cmp.isLoading ? <Spinner /> : cmp.error ? <ErrorState error={cmp.error} /> : cmp.data && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Stat label="Score change" value={<Delta v={cmp.data.score_delta} />} />
                      <Stat label="New issues" value={cmp.data.new.length} tone={cmp.data.new.length ? "danger" : "ok"} />
                      <Stat label="Resolved" value={cmp.data.resolved.length} tone="ok" />
                      <Stat label="Persistent" value={cmp.data.persistent.length} tone={cmp.data.persistent.length ? "warn" : "ok"} />
                    </div>
                    <Card>
                      <SectionTitle>Category changes</SectionTitle>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((c) => <div key={c} className="flex items-center justify-between rounded-lg bg-surface2 px-3 py-2 text-sm"><span>{CATEGORY_LABEL[c]}</span><Delta v={cmp.data!.category_deltas[c]} /></div>)}
                      </div>
                    </Card>
                    <FindingGroup title="New issues" tone="danger" items={cmp.data.new} />
                    <FindingGroup title="Resolved issues" tone="ok" items={cmp.data.resolved} />
                    <FindingGroup title="Persistent issues" tone="muted" items={cmp.data.persistent} />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
