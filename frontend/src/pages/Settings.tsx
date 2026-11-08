import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import FormModal, { type FieldDef } from "../components/FormModal";
import { api } from "../lib/api";
import { money, useAction, useCurrency } from "../lib/crm";
import { CATEGORY_LABEL } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { CategoryKey, Pkg, SystemStatus, User } from "../lib/types";
import { Badge, Button, Card, Confirm, ErrorState, PageHeader, SectionTitle, Spinner } from "../components/ui";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5 text-sm first:border-t-0"><span className="text-muted">{k}</span><span>{children}</span></div>
);

const PACKAGE_FIELDS: FieldDef[] = [
  { key: "name", label: "Package name", required: true, wide: true },
  { key: "price", label: "Price", kind: "number", step: "any", required: true, hint: "In your agency currency." },
  { key: "billing", label: "Billing", kind: "select", options: [["one_time", "One-time"], ["monthly", "Monthly"]] },
  { key: "is_active", label: "Available for new proposals", kind: "select", options: [["true", "Yes"], ["false", "No"]] },
  { key: "description", label: "What's included", kind: "textarea" },
];

function Packages() {
  const currency = useCurrency();
  const pkgs = useQuery({ queryKey: ["packages"], queryFn: () => api<Pkg[]>("/packages") });
  const [form, setForm] = useState<"new" | Pkg | null>(null);
  const [del, setDel] = useState<Pkg | null>(null);
  const save = useAction((p: { id?: number; body: Record<string, unknown> }) => api(p.id ? `/packages/${p.id}` : "/packages", { method: p.id ? "PATCH" : "POST", body: p.body }), { invalidate: ["packages"], ok: "Package saved" });
  const remove = useAction((p: Pkg) => api(`/packages/${p.id}`, { method: "DELETE" }), { invalidate: ["packages"], ok: "Package deleted", done: () => setDel(null) });
  return (
    <Card className="lg:col-span-2">
      <SectionTitle aside={<Button size="sm" variant="primary" onClick={() => setForm("new")}><Plus className="size-3.5" />Add package</Button>}>Pricing packages</SectionTitle>
      {pkgs.isLoading ? <Spinner /> : pkgs.error ? <ErrorState error={pkgs.error} retry={pkgs.refetch} /> : !pkgs.data?.length ? (
        <p className="text-sm text-muted">No packages yet. Add your services and prices here, then pick them when building proposals. Nothing is pre-filled: your pricing is yours.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 font-medium">Package</th><th className="font-medium">Price</th><th className="font-medium">Billing</th><th className="font-medium">Status</th><th /></tr></thead>
          <tbody>{pkgs.data.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="py-2.5"><div className="font-medium">{p.name}</div><div className="max-w-md truncate text-xs text-muted">{p.description}</div></td>
              <td className="num">{money(p.price, currency)}</td><td>{p.billing === "monthly" ? "Monthly" : "One-time"}</td><td>{p.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Hidden</Badge>}</td>
              <td className="text-right"><Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setForm(p)}><Pencil className="size-3.5" /></Button><Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDel(p)}><Trash2 className="size-3.5" /></Button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {form && <FormModal title={form === "new" ? "Add package" : "Edit package"} fields={PACKAGE_FIELDS} initial={form === "new" ? { billing: "one_time", is_active: "true" } : { ...form, is_active: String(form.is_active) }} submitLabel="Save package"
        onSubmit={(b) => save.mutateAsync({ id: form === "new" ? undefined : form.id, body: { ...b, is_active: b.is_active === "true" } })} onClose={() => setForm(null)} />}
      {del && <Confirm title="Delete this package?" confirmLabel="Delete package" busy={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => remove.mutate(del)} body="Existing proposals keep their line items and prices. Consider hiding the package instead if you may need it again." />}
    </Card>
  );
}

export default function SettingsPage({ user }: { user: User }) {
  const { theme, set } = useTheme();
  const qc = useQueryClient();
  const [editAgency, setEditAgency] = useState(false);
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api<SystemStatus>("/system/status") });
  const s = sys.data;
  const saveAgency = useAction((b: Record<string, unknown>) => api<{ name: string; currency: string }>("/organisation", { method: "PATCH", body: b }),
    { ok: "Agency updated", done: (o) => qc.setQueryData(["me"], { ...user, organisation_name: o.name, organisation_currency: o.currency }) });
  return (
    <>
      <PageHeader title="Settings" subtitle="Configuration status. Secrets are read from environment variables on the server and are never sent to the browser." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Appearance</SectionTitle>
          <div className="flex gap-2" role="radiogroup" aria-label="Theme">
            {(["light", "dark"] as const).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} onClick={() => set(t)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium capitalize ${theme === t ? "border-accent bg-accentsoft text-accent" : "border-line text-muted hover:bg-surface2"}`}>
                {t === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}{t}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Saved in this browser.</p>
        </Card>

        <Card>
          <SectionTitle aside={user.role === "owner" && <Button size="sm" onClick={() => setEditAgency(true)}><Pencil className="size-3.5" />Edit</Button>}>Account & agency</SectionTitle>
          <Row k="Agency">{user.organisation_name}</Row><Row k="Currency">{user.organisation_currency}</Row><Row k="Name">{user.full_name}</Row><Row k="Email">{user.email}</Row><Row k="Role"><Badge>{user.role}</Badge></Row>
        </Card>
        <Packages />

        {sys.isLoading ? <Spinner /> : sys.error || !s ? <ErrorState error={sys.error} retry={sys.refetch} /> : (
          <>
            <Card>
              <SectionTitle>Scoring weights</SectionTitle>
              {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((c) => <Row key={c} k={CATEGORY_LABEL[c]}><span className="num">{s.category_weights[c] ?? 0}%</span></Row>)}
              <p className="mt-2 text-xs text-muted">Change with the <code className="font-mono">SEO_CATEGORY_WEIGHTS</code> environment variable, then restart the backend.</p>
            </Card>
            <Card>
              <SectionTitle>System</SectionTitle>
              <Row k="Environment">{s.environment}</Row><Row k="Database"><Badge tone="info">{s.database}</Badge></Row>
              <Row k="Crawl limits"><span className="num">{s.crawl_limits.max_pages} pages · depth {s.crawl_limits.max_depth} · {s.crawl_limits.delay_seconds}s delay</span></Row>
              <Row k="Registration">{s.registration_open ? "Open" : "Closed"}</Row>
            </Card>
            <Card>
              <SectionTitle>AI providers</SectionTitle>
              <Row k="Active provider">{!s.ai.configured ? <Badge>{s.ai_provider === "none" ? "None: deterministic mode" : `${s.ai_provider}: no key set`}</Badge> : <Badge tone="accent">{s.ai.provider}</Badge>}</Row>
              {s.ai.configured && <Row k="Model"><span className="font-mono text-xs">{s.ai.model}</span></Row>}
              {Object.entries(s.ai_keys_configured).map(([k, v]) => <Row key={k} k={k[0].toUpperCase() + k.slice(1)}>{v ? <Badge tone="ok">Key configured</Badge> : <Badge>No key</Badge>}</Row>)}
              <p className="mt-2 text-xs text-muted">AI features (recommendations, keyword ideas, competitor insights, content drafts) switch on when a provider and key are set in <code className="font-mono">backend/.env</code>. Everything else works without one. Keys are never sent to the browser.</p>
            </Card>
            <Card>
              <SectionTitle>External integrations</SectionTitle>
              {Object.entries(s.integrations).map(([k, v]) => <Row key={k} k={k.replace(/_/g, " ")}><Badge>{v}</Badge></Row>)}
              <p className="mt-2 text-xs text-muted">Nothing is claimed as connected unless it is implemented and authorised.</p>
            </Card>
          </>
        )}
      </div>
      {editAgency && <FormModal title="Edit agency" submitLabel="Save" onClose={() => setEditAgency(false)} onSubmit={(p) => saveAgency.mutateAsync({ name: p.name, currency: String(p.currency).toUpperCase() })}
        initial={{ name: user.organisation_name, currency: user.organisation_currency }}
        fields={[{ key: "name", label: "Agency name", required: true }, { key: "currency", label: "Currency (ISO code)", required: true, hint: "e.g. USD, EUR, GBP, INR. Changing it re-labels existing amounts; it does not convert them." }]} />}
    </>
  );
}
