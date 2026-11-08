import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { ToastProvider } from "./components/ui";
import { ThemeProvider } from "./lib/theme";
import type { Business } from "./lib/types";

export function renderApp(ui: ReactElement, route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider><QueryClientProvider client={client}><ToastProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></ToastProvider></QueryClientProvider></ThemeProvider>,
  );
}

export const emptyBusiness: Business = {
  currency: "USD", leads_total: 0, leads_new: 0, leads_qualified: 0, clients_active: 0, clients_total: 0, proposals_sent: 0, proposals_accepted: 0,
  conversion_rate: null, monthly_recurring_value: 0, accepted_proposal_value: 0, funnel: [], leads_by_month: [], client_growth: [], attention: [],
};

type Handler = (init: RequestInit | undefined, url: string) => { status?: number; body?: unknown };
/** Stubs fetch with routes keyed by "METHOD /api/path". Unmatched requests fail the test loudly. */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.split("?")[0]}`;
    calls.push({ method, path: url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    if (!(key in routes)) throw new Error(`Unmocked request: ${key}`);
    const r = routes[key];
    const out = typeof r === "function" ? (r as Handler)(init, url) : { body: r };
    const status = out.status ?? 200;
    return { ok: status < 400, status, json: async () => out.body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
