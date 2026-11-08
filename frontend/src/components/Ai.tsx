import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { SystemStatus } from "../lib/types";
import { Badge } from "./ui";

export function useAi() {
  const q = useQuery({ queryKey: ["system"], queryFn: () => api<SystemStatus>("/system/status"), staleTime: 60_000 });
  return { configured: !!q.data?.ai.configured, provider: q.data?.ai.provider ?? "", model: q.data?.ai.model ?? "", loading: q.isLoading };
}

/** Everything produced by a model carries this label so it is never mistaken for a measured fact. */
export const AiBadge = ({ label = "AI-generated" }: { label?: string }) => <Badge tone="accent"><Sparkles className="mr-1 size-3" aria-hidden />{label}</Badge>;

export function AiNotice() {
  const ai = useAi();
  if (ai.loading || ai.configured) return null;
  return (
    <div role="note" className="mb-4 rounded-2xl border border-line bg-surface2 px-4 py-3 text-sm text-muted">
      <strong className="text-fg">AI is not configured.</strong> Everything that is not AI-written still works. To enable AI features, set <code className="font-mono">AI_PROVIDER</code> and the matching API key in{" "}
      <code className="font-mono">backend/.env</code> and restart the backend. <Link to="/settings" className="text-accent hover:underline">See Settings</Link>.
    </div>
  );
}
