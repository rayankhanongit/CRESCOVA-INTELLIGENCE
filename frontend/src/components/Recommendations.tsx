import { useQuery } from "@tanstack/react-query";
import { Check, Sparkles, X } from "lucide-react";
import { api } from "../lib/api";
import { useAction } from "../lib/crm";
import type { Recommendation } from "../lib/types";
import { AiBadge, useAi } from "./Ai";
import { Badge, Button, Card, SectionTitle, SeverityBadge, Spinner } from "./ui";
import type { Severity } from "../lib/types";

/** AI interpretation of the audit's deterministic findings. Reviewing here only records your decision: no website is ever changed. */
export default function Recommendations({ auditId }: { auditId: number }) {
  const ai = useAi();
  const recs = useQuery({ queryKey: ["recommendations", auditId], queryFn: () => api<Recommendation[]>(`/audits/${auditId}/recommendations`) });
  const gen = useAction(() => api<Recommendation[]>(`/audits/${auditId}/recommendations`, { method: "POST" }), { invalidate: ["recommendations", "usage"], ok: "Recommendations generated" });
  const review = useAction((p: { id: number; status: Recommendation["status"] }) => api(`/recommendations/${p.id}`, { method: "PATCH", body: { status: p.status } }), { invalidate: ["recommendations"] });
  const list = recs.data ?? [];

  return (
    <Card>
      <SectionTitle aside={<AiBadge />}>AI recommendations</SectionTitle>
      <p className="mb-3 text-sm text-muted">The AI reads your stored findings above and explains them. It cannot add findings or change scores. Review each suggestion before acting on it. Nothing is applied to the website.</p>
      <Button variant="primary" busy={gen.isPending} disabled={!ai.configured} title={ai.configured ? undefined : "AI is not configured"} onClick={() => gen.mutate()}>
        <Sparkles className="size-4" />{list.length ? "Regenerate unreviewed" : "Generate recommendations"}
      </Button>
      {!ai.configured && !ai.loading && <p className="mt-2 text-xs text-muted">AI is not configured (set an API key in <code className="font-mono">backend/.env</code>). The deterministic findings are unaffected.</p>}
      {recs.isLoading ? <Spinner /> : (
        <ul className="mt-4 space-y-3">
          {list.map((r) => (
            <li key={r.id} className={`rounded-xl border border-line p-4 text-sm ${r.status === "dismissed" ? "opacity-60" : ""}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {r.severity && <SeverityBadge severity={r.severity as Severity} />}<span className="font-medium">{r.check_name}</span>
                {r.status !== "suggested" && <Badge tone={r.status === "accepted" ? "ok" : "muted"}>{r.status === "accepted" ? "Accepted" : "Dismissed"}</Badge>}
              </div>
              <p><span className="font-medium">What it means: </span>{r.interpretation}</p>
              <p className="mt-1"><span className="font-medium">Suggested fix: </span>{r.recommendation}</p>
              {r.example && <p className="mt-1 rounded-lg bg-surface2 p-2 font-mono text-xs">{r.example}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={() => review.mutate({ id: r.id, status: "accepted" })} disabled={r.status === "accepted"}><Check className="size-3.5" />Accept</Button>
                <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: r.id, status: "dismissed" })} disabled={r.status === "dismissed"}><X className="size-3.5" />Dismiss</Button>
                <span className="ml-auto text-xs text-muted">{r.provider} · {r.model}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
