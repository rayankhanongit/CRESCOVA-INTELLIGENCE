import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/ui";
import type { ClientStatus, LeadStatus, Priority, ProposalStatus, User } from "./types";

export const LEAD_STAGES: { key: LeadStatus; label: string }[] = [
  { key: "new", label: "New" }, { key: "contacted", label: "Contacted" }, { key: "qualified", label: "Qualified" },
  { key: "proposal_sent", label: "Proposal sent" }, { key: "negotiation", label: "Negotiation" }, { key: "converted", label: "Converted" }, { key: "lost", label: "Lost" },
];
export const LEAD_LABEL = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.label])) as Record<LeadStatus, string>;
export const CLIENT_STATUSES: ClientStatus[] = ["onboarding", "active", "paused", "completed", "cancelled"];
export const PROPOSAL_STATUSES: ProposalStatus[] = ["draft", "sent", "accepted", "rejected", "expired"];
export const PRIORITIES: Priority[] = ["low", "medium", "high"];
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Agency currency, read from the cached signed-in user (no request). */
export function useCurrency(): string {
  return useQuery<User | null>({ queryKey: ["me"], enabled: false }).data?.organisation_currency ?? "USD";
}

export function money(v: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v); } catch { return `${currency} ${v.toFixed(2)}`; }
}

/** Same arithmetic as the server (per-line rounding to 2dp). The server's figures are authoritative once saved. */
export function proposalTotals(items: { quantity: number; unit_price: number }[], discountPercent: number) {
  const r = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const subtotal = r(items.reduce((s, i) => s + r(i.quantity * i.unit_price), 0));
  const discount = r((subtotal * discountPercent) / 100);
  return { subtotal, discount, total: r(subtotal - discount) };
}

/** Local calendar date as YYYY-MM-DD (task due dates are plain dates, so compare as strings). */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Only http(s) values may become link targets; anything else renders as plain text. */
export const safeHref = (u: string): string | undefined => (/^https?:\/\//i.test(u) ? u : undefined);

/** Mutation with the standard toast + cache invalidation (by query-key prefix) behaviour. */
export function useAction<A = void, R = unknown>(fn: (a: A) => Promise<R>, opts: { invalidate?: string[]; ok?: string | ((r: R) => string); done?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (opts.ok) toast("success", typeof opts.ok === "function" ? opts.ok(r) : opts.ok);
      opts.done?.(r);
    },
    onError: (e: Error) => toast("error", e.message),
  });
}
