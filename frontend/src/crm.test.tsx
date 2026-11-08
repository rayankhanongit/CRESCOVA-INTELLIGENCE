import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import FormModal from "./components/FormModal";
import { ToastProvider } from "./components/ui";
import { money, proposalTotals, safeHref, todayStr } from "./lib/crm";
import type { Business, Client, Lead, OnboardingItem, Pkg, Proposal, Task } from "./lib/types";
import ClientDetail from "./pages/ClientDetail";
import LeadsPage from "./pages/Leads";
import { BusinessSection } from "./pages/Overview";
import ProposalEditor from "./pages/ProposalEditor";
import TasksPage from "./pages/Tasks";
import { emptyBusiness, mockApi, renderApp } from "./test-utils";

const lead = (o: Partial<Lead> = {}): Lead => ({ id: 1, name: "Ann Lee", email: "", phone: "", company: "Acme", website: "", service_interest: "SEO", budget: 2000, source: "Referral", notes: "", status: "new", priority: "", qualification: null, last_contacted_at: null, next_follow_up: null, created_at: "2026-01-01T00:00:00Z", client_id: null, ...o });
const client = (o: Partial<Client> = {}): Client => ({ id: 1, source_lead_id: null, name: "Acme Co", company: "", email: "", phone: "", website: "", services: "", contract_start: null, contract_end: null, monthly_value: 0, status: "onboarding", notes: "", created_at: "2026-01-01T00:00:00Z", onboarding_done: 0, onboarding_total: 0, ...o });
const proposal = (o: Partial<Proposal> = {}): Proposal => ({ id: 5, lead_id: 1, client_id: null, recipient_name: "Ann Lee", title: "SEO plan", description: "", deliverables: "", timeline: "", payment_terms: "", discount_percent: 0, status: "draft", valid_until: null, sent_at: null, created_at: "2026-01-01T00:00:00Z", items: [], subtotal: 0, discount_amount: 0, total: 0, ...o });
const pkg: Pkg = { id: 3, name: "SEO Growth", description: "", price: 100.1, billing: "monthly", is_active: true };
const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

describe("crm helpers", () => {
  it("computes proposal totals exactly like the server (per-line rounding)", () => {
    expect(proposalTotals([{ quantity: 2, unit_price: 100.1 }, { quantity: 1, unit_price: 50 }], 10)).toEqual({ subtotal: 250.2, discount: 25.02, total: 225.18 });
    expect(proposalTotals([], 0).total).toBe(0);
  });
  it("formats money and survives an invalid currency code", () => {
    expect(money(1234.5, "USD")).toMatch(/1,234\.50/);
    expect(money(5, "NOPE")).toBe("NOPE 5.00");
  });
  it("only allows http(s) link targets", () => {
    expect(safeHref("https://x.com")).toBe("https://x.com");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
  it("formats today's local date", () => { expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});

describe("FormModal", () => {
  const fields = [{ key: "name", label: "Name", required: true }, { key: "budget", label: "Budget", kind: "number" as const }, { key: "due", label: "Due", kind: "date" as const }, { key: "owner", label: "Owner", kind: "id" as const, options: [["", "None"], ["7", "Sam"]] as [string, string][] }];
  it("blocks submit when a required field is empty", async () => {
    const onSubmit = vi.fn();
    renderApp(<FormModal title="T" fields={fields} submitLabel="Save" onSubmit={onSubmit} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This field is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("sends blanks as null and ids as numbers, then closes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
    renderApp(<FormModal title="T" fields={fields} submitLabel="Save" onSubmit={onSubmit} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Name/), "  Ann ");
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "7");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ name: "Ann", budget: null, due: null, owner: 7 });
  });
  it("keeps the modal open and shows the server's message on failure", async () => {
    const onClose = vi.fn();
    renderApp(<FormModal title="T" fields={fields} submitLabel="Save" onSubmit={() => Promise.reject(new Error("email: not valid"))} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Name/), "A");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("email: not valid");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("leads board", () => {
  it("shows leads in their pipeline column and persists a move through the API", async () => {
    const calls = mockApi({
      "GET /api/leads": [lead(), lead({ id: 2, name: "Bo Chen", status: "qualified" })],
      "PATCH /api/leads/1": () => ({ body: lead({ status: "contacted" }) }),
    });
    renderApp(<ToastProvider><LeadsPage /></ToastProvider>);
    const cols = ["New", "Contacted", "Qualified", "Proposal sent", "Negotiation", "Converted", "Lost"];
    for (const c of cols) expect(await screen.findByRole("region", { name: c })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "New" })).getByText("Ann Lee")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Qualified" })).getByText("Bo Chen")).toBeInTheDocument();

    const move = screen.getByLabelText("Move Ann Lee");
    expect(within(move).getByRole("option", { name: "Converted" })).toBeDisabled();  // conversion has its own action
    await userEvent.selectOptions(move, "contacted");
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/api/leads/1", body: { status: "contacted" } });
  });

  it("searches on the server and can switch to the table", async () => {
    const calls = mockApi({ "GET /api/leads": [lead()] });
    renderApp(<LeadsPage />);
    await screen.findByText("Ann Lee");
    await userEvent.type(screen.getByLabelText("Search leads"), "ann");
    await waitFor(() => expect(calls.some((c) => c.path.includes("q=ann"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Next follow-up" })).toBeInTheDocument();
  });

  it("creates a lead and requires a name", async () => {
    let created = false;
    const calls = mockApi({ "GET /api/leads": () => ({ body: created ? [lead()] : [] }), "POST /api/leads": () => { created = true; return { status: 201, body: lead() }; } });
    renderApp(<ToastProvider><LeadsPage /></ToastProvider>);
    expect(await screen.findByText("No leads yet")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /Add lead/ })[0]);
    const dlg = screen.getByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: "Add lead" }));
    expect(within(dlg).getByText("This field is required.")).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText(/Name/), "Ann Lee");
    await userEvent.type(within(dlg).getByLabelText("Budget"), "2000");
    await userEvent.click(within(dlg).getByRole("button", { name: "Add lead" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "Ann Lee", budget: 2000, email: "", next_follow_up: null });
  });
});

describe("proposal editor", () => {
  const routes = { "GET /api/leads": [lead()], "GET /api/clients": [], "GET /api/packages": [pkg] };
  const page = (path: string) => renderApp(<ToastProvider><Routes><Route path="/proposals/:id" element={<ProposalEditor />} /></Routes></ToastProvider>, path);

  it("builds line items from a package, updates totals live and saves the payload", async () => {
    const calls = mockApi({ ...routes, "POST /api/proposals": () => ({ status: 201, body: proposal({ id: 9 }) }), "GET /api/proposals/9": proposal({ id: 9 }) });
    page("/proposals/new?lead=1");
    await userEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    expect(screen.getByRole("alert")).toHaveTextContent("title");

    await userEvent.type(screen.getByLabelText("Title *"), "SEO plan");
    await userEvent.selectOptions(await screen.findByLabelText("Add from package"), "3");
    await userEvent.clear(screen.getByLabelText("Line 1 quantity"));
    await userEvent.type(screen.getByLabelText("Line 1 quantity"), "2");
    await userEvent.click(screen.getByRole("button", { name: /Custom line/ }));
    await userEvent.type(screen.getByLabelText("Line 2 description"), "Setup");
    await userEvent.clear(screen.getByLabelText("Line 2 unit price"));
    await userEvent.type(screen.getByLabelText("Line 2 unit price"), "50");
    await userEvent.clear(screen.getByLabelText("Discount %"));
    await userEvent.type(screen.getByLabelText("Discount %"), "10");
    expect(screen.getByText(/225\.18/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      lead_id: 1, client_id: null, title: "SEO plan", discount_percent: 10,
      items: [{ package_id: 3, description: "SEO Growth", quantity: 2, unit_price: 100.1 }, { package_id: null, description: "Setup", quantity: 1, unit_price: 50 }],
    });
  });

  it("requires a recipient", async () => {
    const calls = mockApi({ ...routes });
    page("/proposals/new");
    await userEvent.type(screen.getByLabelText("Title *"), "No one");
    await userEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    expect(screen.getByRole("alert")).toHaveTextContent("lead or a client");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("locks a sent proposal, offers PDF and the next statuses, and never emails", async () => {
    const calls = mockApi({ ...routes, "GET /api/proposals/5": proposal({ status: "sent", items: [{ id: 1, package_id: null, description: "Audit", quantity: 1, unit_price: 100, line_total: 100 }], subtotal: 100, total: 100 }) });
    page("/proposals/5");
    expect(await screen.findByLabelText("Title *")).toBeDisabled();
    expect(screen.getByRole("link", { name: /Download PDF/ })).toHaveAttribute("href", "/api/proposals/5/pdf");
    expect(screen.getByRole("button", { name: "Mark accepted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(calls.some((c) => /email|send/i.test(c.path))).toBe(false);
  });

  it("offers onboarding only once accepted and a client exists", async () => {
    mockApi({ ...routes, "GET /api/proposals/5": proposal({ status: "accepted", client_id: 4 }) });
    page("/proposals/5");
    expect(await screen.findByRole("button", { name: "Start client onboarding" })).toBeInTheDocument();
  });
});

describe("clients and onboarding", () => {
  const items: OnboardingItem[] = [1, 2, 3].map((n) => ({ id: n, client_id: 1, title: `Step ${n}`, done: n === 1, done_at: null, position: n }));
  const base = { "GET /api/clients/1": client({ onboarding_done: 1, onboarding_total: 3 }), "GET /api/clients/1/history": [], "GET /api/proposals": [] };
  const page = () => renderApp(<ToastProvider><Routes><Route path="/clients/:id" element={<ClientDetail />} /></Routes></ToastProvider>, "/clients/1");

  it("shows checklist progress and persists a toggle", async () => {
    const calls = mockApi({ ...base, "GET /api/clients/1/onboarding": items, "PATCH /api/onboarding/2": () => ({ body: { ...items[1], done: true } }) });
    page();
    expect(await screen.findByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Onboarding progress" })).toHaveAttribute("aria-valuenow", "1");
    await userEvent.click(screen.getByRole("checkbox", { name: "Step 2" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ done: true });
    expect(screen.getByText(/Never ask a client to send passwords/)).toBeInTheDocument();
  });

  it("offers to start onboarding when there is no checklist", async () => {
    mockApi({ ...base, "GET /api/clients/1/onboarding": [] });
    page();
    expect(await screen.findByRole("button", { name: "Start onboarding" })).toBeInTheDocument();
  });
});

describe("tasks and reminders", () => {
  const task = (o: Partial<Task>): Task => ({ id: 1, title: "Chase invoice", notes: "", due_date: null, priority: "medium", completed_at: null, assignee_id: null, website_id: null, client_id: null, ...o });
  it("raises an in-app reminder for overdue and due-soon tasks and completes a task via the API", async () => {
    const open = [task({ id: 1, title: "Late one", due_date: dayOffset(-2) }), task({ id: 2, title: "Soon one", due_date: dayOffset(1) }), task({ id: 3, title: "Far one", due_date: dayOffset(20) })];
    const calls = mockApi({ "GET /api/tasks": open, "GET /api/team": [], "GET /api/websites": [], "GET /api/clients": [], "PATCH /api/tasks/1": () => ({ body: task({ id: 1, completed_at: "2026-01-01T00:00:00Z" }) }) });
    renderApp(<ToastProvider><TasksPage /></ToastProvider>);
    const banner = (await screen.findByText("1 overdue")).closest("[role=status]")!;
    expect(banner).toHaveTextContent("1 overdue");
    expect(banner).toHaveTextContent("1 due within 2 days");
    expect(await screen.findByText(/Overdue ·/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("checkbox", { name: "Complete Late one" })[0]);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ done: true });
  });
});

describe("dashboard business section", () => {
  const b: Business = { ...emptyBusiness, leads_total: 10, leads_new: 4, leads_qualified: 3, clients_total: 2, clients_active: 2, proposals_sent: 5, proposals_accepted: 2, conversion_rate: 20,
    monthly_recurring_value: 1500, accepted_proposal_value: 4200.5, funnel: [{ stage: "new", leads: 4 }, { stage: "converted", leads: 2 }], leads_by_month: [{ month: "2026-01", leads: 10 }], client_growth: [{ month: "2026-01", clients: 2 }],
    attention: [{ kind: "task", id: 1, title: "Chase invoice", due: "2026-01-01", overdue: true }, { kind: "followup", id: 7, title: "Follow up with Ann", due: "2026-01-02", overdue: false }] };
  it("renders real figures, labels revenue honestly and links attention items", () => {
    renderApp(<BusinessSection b={b} />);
    expect(screen.getByText("Conversion rate").parentElement).toHaveTextContent("20%");
    expect(screen.getByText("Monthly recurring value").parentElement).toHaveTextContent(/1,500\.00/);
    expect(screen.getByText("Accepted proposals").parentElement).toHaveTextContent(/4,200\.50/);
    expect(screen.getByText(/Invoices and payments are not tracked/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Follow up with Ann" })).toHaveAttribute("href", "/leads/7");
    expect(screen.getByRole("link", { name: "Chase invoice" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("img", { name: /leads at each pipeline stage/ })).toBeInTheDocument();
  });
});
