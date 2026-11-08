import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import NotificationBell from "./components/NotificationBell";
import { ToastProvider } from "./components/ui";
import type { AppNotification, Client, ContentEntry, ReportDetailData } from "./lib/types";
import CalendarPage, { iso, monthGrid, weekStart } from "./pages/Calendar";
import ReportDetail from "./pages/ReportDetail";
import ReportsPage from "./pages/Reports";
import { mockApi, renderApp } from "./test-utils";

const now = new Date();
const day = (n: number) => iso(new Date(now.getFullYear(), now.getMonth(), n));
const entry = (o: Partial<ContentEntry> = {}): ContentEntry => ({ id: 1, title: "Launch post", kind: "social_post", platform: "Instagram", body: "Caption", params: {}, ai_generated: false, status: "scheduled", client_id: null, publish_date: day(15), media: [], ...o });
const client: Client = { id: 3, source_lead_id: null, name: "Acme", company: "", email: "", phone: "", website: "", services: "", contract_start: null, contract_end: null, monthly_value: 0, status: "active", notes: "", created_at: "2026-01-01T00:00:00Z", onboarding_done: 0, onboarding_total: 0 };

describe("calendar helpers", () => {
  it("builds whole Monday-first weeks that contain the month", () => {
    const grid = monthGrid(new Date(2026, 10, 15));  // November 2026 starts on a Sunday
    expect(grid.length % 7).toBe(0);
    expect(grid[0].getDay()).toBe(1);
    expect(iso(grid[0])).toBe("2026-10-26");
    expect(grid.some((d) => iso(d) === "2026-11-30") && grid.some((d) => iso(d) === "2026-11-01")).toBe(true);
    expect(iso(weekStart(new Date(2026, 10, 11)))).toBe("2026-11-09");  // a Wednesday
  });
});

describe("content calendar", () => {
  const routes = { "GET /api/clients": [client] };

  it("puts entries on their date and filters on the server by client and platform", async () => {
    const calls = mockApi({ ...routes, "GET /api/content": [entry()] });
    renderApp(<ToastProvider><CalendarPage /></ToastProvider>);
    const cell = await screen.findByRole("gridcell", { name: day(15) });
    expect(within(cell).getByText(/Instagram · Launch post/)).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: day(16) })).not.toHaveTextContent("Launch post");
    expect(calls[0].path).toMatch(/start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}/);

    await userEvent.selectOptions(screen.getByLabelText("Filter by client"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Filter by platform"), "Instagram");
    await waitFor(() => expect(calls.some((c) => c.path.includes("client_id=3") && c.path.includes("platform=Instagram"))).toBe(true));
  });

  it("switches between month, week and list views", async () => {
    mockApi({ ...routes, "GET /api/content": [entry(), entry({ id: 2, title: "Idea without a date", publish_date: null, status: "idea" })] });
    renderApp(<ToastProvider><CalendarPage /></ToastProvider>);
    await screen.findByRole("gridcell", { name: day(15) });
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getAllByRole("gridcell")).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByText("Idea without a date")).toBeInTheDocument();
    expect(screen.getByText("Unscheduled")).toBeInTheDocument();
  });

  it("creates an entry on a clicked day with media references and states that nothing is published", async () => {
    const calls = mockApi({ ...routes, "GET /api/content": [], "POST /api/content": () => ({ status: 201, body: entry() }) });
    renderApp(<ToastProvider><CalendarPage /></ToastProvider>);
    expect(await screen.findByText(/Publishing to social platforms is not connected/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: `Add content on ${day(20)}` }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByLabelText("Publishing date")).toHaveValue(day(20));
    await userEvent.type(within(dlg).getByLabelText(/Title/), "Spring offer");
    await userEvent.type(within(dlg).getByLabelText("Media references"), "https://cdn.example.com/a.jpg{Enter}hero.png{Enter}");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ title: "Spring offer", publish_date: day(20), kind: "social_post", status: "idea", media: ["https://cdn.example.com/a.jpg", "hero.png"] });
  });

  it("edits an entry and offers delete from the edit dialog", async () => {
    const calls = mockApi({ ...routes, "GET /api/content": [entry()], "PATCH /api/content/1": () => ({ body: entry({ status: "published" }) }), "DELETE /api/content/1": () => ({ status: 204 }) });
    renderApp(<ToastProvider><CalendarPage /></ToastProvider>);
    await userEvent.click(await screen.findByRole("button", { name: /Launch post/ }));
    const dlg = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dlg).getByLabelText("Status"), "published");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ status: "published" }));

    await userEvent.click(await screen.findByRole("button", { name: /Launch post/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("reports", () => {
  const report = (sections: Record<string, any>, extra: Partial<ReportDetailData["data"]> = {}): ReportDetailData => ({
    id: 9, title: "Acme October", website_id: 1, client_id: 3, period_start: "2026-10-01", period_end: "2026-10-31", sections: Object.keys(sections), created_at: "2026-11-01T00:00:00Z", notes: "",
    data: { meta: { period_start: "2026-10-01", period_end: "2026-10-31", generated_at: "2026-11-01T00:00:00Z", website: { id: 1, name: "Acme Site", url: "https://acme.com/" }, client: { id: 3, name: "Acme", status: "active" } },
      integrations: { google_analytics_4: "Not connected.", google_search_console: "Not connected." }, skipped: [], sections, ...extra } });

  it("validates before generating, then posts the chosen scope, period and sections", async () => {
    const calls = mockApi({ "GET /api/reports": [], "GET /api/websites": [{ id: 1, name: "Acme Site" }], "GET /api/clients": [client],
      "POST /api/reports": () => ({ status: 201, body: report({}) }), "GET /api/reports/9": report({ notes: { source: "Written by your team", text: "Hi" } }) });
    renderApp(<ToastProvider><Routes><Route path="/reports" element={<ReportsPage />} /><Route path="/reports/:id" element={<ReportDetail />} /></Routes></ToastProvider>, "/reports");
    await userEvent.click((await screen.findAllByRole("button", { name: /Generate report/ }))[0]);
    const dlg = screen.getByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: "Generate" }));
    expect(within(dlg).getByRole("alert")).toHaveTextContent("title");
    await userEvent.type(within(dlg).getByLabelText("Title *"), "Acme October");
    await userEvent.click(within(dlg).getByRole("button", { name: "Generate" }));
    expect(within(dlg).getByRole("alert")).toHaveTextContent("website, a client");
    await userEvent.selectOptions(within(dlg).getByLabelText("Website"), "1");
    await userEvent.click(within(dlg).getByLabelText(/Keywords/));
    expect(within(dlg).getByText(/Google Analytics and Search Console are not connected/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const sent = calls.find((c) => c.method === "POST")!.body;
    expect(sent).toMatchObject({ title: "Acme October", website_id: 1, client_id: null });
    expect(sent.sections.sort()).toEqual(["keywords", "seo", "tasks"]);
    expect(sent.period_start <= sent.period_end).toBe(true);
    expect(await screen.findByText("Written by your team")).toBeInTheDocument();  // navigated to the new report
  });

  it("labels every section by data source and never shows analytics figures", async () => {
    mockApi({ "GET /api/reports/9": report({
      seo: { source: "Measured: crawler", score: 82, score_change: 5, first_audit_date: "2026-10-02", latest_audit_date: "2026-10-30", pages_crawled: 12, critical: 1, warnings: 4, checks_passed: 90, category_scores: { technical: 90, onpage: null },
             open_issues: [{ issue: "Page has a title", severity: "critical", affected_urls: 3 }], resolved: ["a"], new: [] },
      keywords: { source: "Entered or imported by your team", items: [{ term: "plumber", intent: "commercial", search_volume: 900, position: null, metrics_source: "Search Console export", origin: "manual" }, { term: "boiler tips", intent: "informational", search_volume: null, position: null, metrics_source: "", origin: "ai_estimate" }] },
      recommendations: { source: "AI-generated text that a person reviewed", items: [{ issue: "Page has a title", recommendation: "Write unique titles.", ai_model: "groq m" }] },
    }, { skipped: ["progress: choose a client to include this section"] }) });
    renderApp(<Routes><Route path="/reports/:id" element={<ReportDetail />} /></Routes>, "/reports/9");
    expect(await screen.findByText("Measured by Crescova")).toBeInTheDocument();
    expect(screen.getByText("AI-generated, reviewed")).toBeInTheDocument();
    expect(screen.getByText("Entered by your team")).toBeInTheDocument();
    expect(screen.getByText(/not a Google ranking factor/)).toBeInTheDocument();
    expect(screen.getByText("not connected").closest("p")).toHaveTextContent(/no traffic, impression, click or ranking-position figures/);
    const ai = screen.getByText("boiler tips").closest("tr")!;
    expect(within(ai).getByText("AI idea (no metrics)")).toBeInTheDocument();
    expect(within(ai).getAllByText("n/a")).toHaveLength(2);  // volume and position stay empty, never invented
    expect(screen.getByText("progress: choose a client to include this section")).toBeInTheDocument();
    for (const f of ["pdf", "csv", "json"]) expect(screen.getByRole("link", { name: new RegExp(f, "i") })).toHaveAttribute("href", `/api/reports/9/export.${f}`);
  });
});

describe("notification bell", () => {
  const items: AppNotification[] = [{ id: 1, kind: "task", title: "Task overdue: Chase invoice", link: "/tasks", read_at: null, created_at: "2026-11-01T00:00:00Z" },
    { id: 2, kind: "audit", title: "Audit finished for Acme: score 80", link: "/audits/4", read_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z" }];

  it("shows the unread count, lists items, and marks one read when opened", async () => {
    const calls = mockApi({ "GET /api/notifications": { unread: 1, items }, "POST /api/notifications/1/read": () => ({ status: 204 }) });
    renderApp(<Routes><Route path="*" element={<NotificationBell />} /></Routes>);
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await userEvent.click(bell);
    expect(screen.getByText("Audit finished for Acme: score 80")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Task overdue: Chase invoice/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/notifications/1/read")).toBe(true));
  });

  it("says when there is nothing new and disables mark-all-read", async () => {
    mockApi({ "GET /api/notifications": { unread: 0, items: [] } });
    renderApp(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });
});
