/**
 * Automated accessibility checks (axe-core) on the main screens: names and labels for controls, roles, landmarks, ARIA validity.
 * jsdom has no layout engine, so colour contrast and focus visibility are NOT covered here; they need a browser check.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/ui";
import type { User } from "./lib/types";
import CalendarPage from "./pages/Calendar";
import ContentStudio from "./pages/ContentStudio";
import KeywordsPage from "./pages/Keywords";
import LeadsPage from "./pages/Leads";
import Login from "./pages/Login";
import ProposalEditor from "./pages/ProposalEditor";
import ReportsPage from "./pages/Reports";
import TasksPage from "./pages/Tasks";
import { mockApi, renderApp } from "./test-utils";

async function violations(root: Element = document.body) {
  const r = await axe.run(root, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const user: User = { id: 1, email: "a@b.co", full_name: "Ada", role: "owner", organisation_id: 1, organisation_name: "Acme", organisation_currency: "USD" };
const ai = { ai: { configured: true, provider: "groq", model: "m" } };
const lead = { id: 1, name: "Ann Lee", email: "", phone: "", company: "Acme", website: "", service_interest: "SEO", budget: 100, source: "Web", notes: "", status: "new", priority: "high", qualification: null, last_contacted_at: null, next_follow_up: "2020-01-01", created_at: "2026-01-01T00:00:00Z", client_id: null };

describe("accessibility (axe-core)", () => {
  it("sign-in and register forms", async () => {
    renderApp(<Login />);
    expect(await violations()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Create a workspace" }));
    expect(await violations()).toEqual([]);
  });

  it("app shell with navigation and the notification bell", async () => {
    mockApi({ "GET /api/notifications": { unread: 2, items: [{ id: 1, kind: "task", title: "Task overdue: X", link: "/tasks", read_at: null, created_at: "2026-01-01T00:00:00Z" }] } });
    renderApp(<Routes><Route element={<Layout user={user} />}><Route index element={<p>home</p>} /></Route></Routes>);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications, 2 unread/ }));
    expect(await violations()).toEqual([]);
  });

  it("leads board and its add-lead dialog", async () => {
    mockApi({ "GET /api/leads": [lead] });
    renderApp(<ToastProvider><LeadsPage /></ToastProvider>);
    await screen.findByText("Ann Lee");
    expect(await violations()).toEqual([]);
    await userEvent.click(screen.getAllByRole("button", { name: /Add lead/ })[0]);
    expect(await violations()).toEqual([]);
  });

  it("proposal editor", async () => {
    mockApi({ "GET /api/leads": [lead], "GET /api/clients": [], "GET /api/packages": [{ id: 1, name: "SEO", description: "", price: 10, billing: "monthly", is_active: true }] });
    renderApp(<ToastProvider><Routes><Route path="/proposals/:id" element={<ProposalEditor />} /></Routes></ToastProvider>, "/proposals/new");
    await userEvent.click(await screen.findByRole("button", { name: /Custom line/ }));
    expect(await violations()).toEqual([]);
  });

  it("content calendar, month grid and entry dialog", async () => {
    mockApi({ "GET /api/clients": [], "GET /api/content": [{ id: 1, title: "Post", kind: "social_post", platform: "Instagram", body: "", params: {}, ai_generated: false, status: "scheduled", client_id: null, publish_date: new Date().toISOString().slice(0, 8) + "15", media: [] }] });
    renderApp(<ToastProvider><CalendarPage /></ToastProvider>);
    await screen.findByText(/Instagram · Post/);
    expect(await violations()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Add content$/ }));
    expect(await violations()).toEqual([]);
  });

  it("tasks, keywords, content studio and the report generator", async () => {
    mockApi({ "GET /api/tasks": [{ id: 1, title: "Chase", notes: "", due_date: "2020-01-01", priority: "high", completed_at: null, assignee_id: null, website_id: null, client_id: null }],
      "GET /api/team": [], "GET /api/websites": [], "GET /api/clients": [], "GET /api/keywords": [], "GET /api/system/status": ai, "GET /api/content": [], "GET /api/reports": [] });
    const t = renderApp(<ToastProvider><TasksPage /></ToastProvider>);
    await screen.findByText("Chase");
    expect(await violations()).toEqual([]);
    t.unmount();
    const k = renderApp(<ToastProvider><KeywordsPage /></ToastProvider>);
    await screen.findByText("No keywords yet");
    expect(await violations()).toEqual([]);
    k.unmount();
    const c = renderApp(<ToastProvider><ContentStudio /></ToastProvider>);
    await screen.findByLabelText("Draft text");
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled());
    expect(await violations()).toEqual([]);
    c.unmount();
    renderApp(<ToastProvider><ReportsPage /></ToastProvider>);
    await userEvent.click((await screen.findAllByRole("button", { name: /Generate report/ }))[0]);
    expect(await violations()).toEqual([]);
  });
});
