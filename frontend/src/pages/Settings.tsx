import { useQuery } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { api } from "../lib/api";
import { CATEGORY_LABEL } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { CategoryKey, SystemStatus, User } from "../lib/types";
import { Badge, Card, ErrorState, PageHeader, SectionTitle, Spinner } from "../components/ui";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5 text-sm first:border-t-0"><span className="text-muted">{k}</span><span>{children}</span></div>
);

export default function SettingsPage({ user }: { user: User }) {
  const { theme, set } = useTheme();
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api<SystemStatus>("/system/status") });
  const s = sys.data;
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
          <SectionTitle>Account & agency</SectionTitle>
          <Row k="Agency">{user.organisation_name}</Row><Row k="Name">{user.full_name}</Row><Row k="Email">{user.email}</Row><Row k="Role"><Badge>{user.role}</Badge></Row>
        </Card>

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
              <Row k="Active provider">{s.ai_provider === "none" ? <Badge>None — deterministic mode</Badge> : <Badge tone="accent">{s.ai_provider}</Badge>}</Row>
              {Object.entries(s.ai_keys_configured).map(([k, v]) => <Row key={k} k={k[0].toUpperCase() + k.slice(1)}>{v ? <Badge tone="ok">Key configured</Badge> : <Badge>No key</Badge>}</Row>)}
              <p className="mt-2 text-xs text-muted">AI recommendations are not built yet (Phase C). The SEO engine works fully without any AI key.</p>
            </Card>
            <Card>
              <SectionTitle>External integrations</SectionTitle>
              {Object.entries(s.integrations).map(([k, v]) => <Row key={k} k={k.replace(/_/g, " ")}><Badge>{v}</Badge></Row>)}
              <p className="mt-2 text-xs text-muted">Nothing is claimed as connected unless it is implemented and authorised.</p>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
