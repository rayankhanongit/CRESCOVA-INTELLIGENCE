import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FindingsList } from "./components/Findings";
import Layout, { NAV } from "./components/Layout";
import { ScoreRing, ToastProvider } from "./components/ui";
import { ApiError, api, detailMessage } from "./lib/api";
import { csvCell, fmtDuration, scoreTone } from "./lib/format";
import { ThemeProvider, useTheme } from "./lib/theme";
import type { Finding, Overview, User, Website } from "./lib/types";
import Login from "./pages/Login";
import OverviewPage, { pivotTrend } from "./pages/Overview";
import WebsitesPage from "./pages/Websites";
import { emptyBusiness, mockApi, renderApp } from "./test-utils";

const user: User = { id: 1, email: "a@b.co", full_name: "Ada", role: "owner", organisation_id: 1, organisation_name: "Acme Agency", organisation_currency: "USD" };
const site = (o: Partial<Website> = {}): Website => ({ id: 1, name: "Acme", url: "https://acme.com/", category: "Plumbing", target_audience: "", market: "UK", platform: "", description: "", created_at: "2026-01-01T00:00:00Z", last_audit_at: null, current_score: null, ...o });
const finding = (o: Partial<Finding> = {}): Finding => ({ id: 1, page_id: 5, check_id: "title_present", name: "Page has a title", severity: "critical", category: "onpage", url: "https://acme.com/a", explanation: "No title element.", why_it_matters: "Titles drive clicks.", recommendation: "Write a unique title.", evidence: "", ...o });

describe("lib", () => {
  it("formats values", () => {
    expect(scoreTone(85)).toBe("ok"); expect(scoreTone(65)).toBe("warn"); expect(scoreTone(10)).toBe("danger"); expect(scoreTone(null)).toBe("muted");
    expect(fmtDuration(450)).toBe("450 ms"); expect(fmtDuration(2500)).toBe("2.5 s"); expect(fmtDuration(null)).toBe("—");
  });
  it("neutralises spreadsheet formulas in CSV cells", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("plain")).toBe('"plain"');
  });
  it("formats FastAPI validation errors", () => {
    expect(detailMessage([{ loc: ["body", "url"], msg: "bad url" }])).toBe("url: bad url");
    expect(detailMessage("nope")).toBe("nope");
  });
  it("sends the CSRF header and surfaces server errors", async () => {
    const calls = mockApi({ "POST /api/x": () => ({ status: 409, body: { detail: "Exists" } }) });
    await expect(api("/x", { method: "POST", body: { a: 1 } })).rejects.toEqual(expect.objectContaining({ status: 409, message: "Exists" } satisfies Partial<ApiError>));
    expect(calls[0].headers["X-Requested-With"]).toBe("crescova");
  });
  it("pivots score trend by date and website", () => {
    const { data, sites } = pivotTrend([{ date: "2026-01-02", score: 70, website: "A" }, { date: "2026-01-01", score: 60, website: "A" }, { date: "2026-01-02", score: 90, website: "B" }]);
    expect(sites).toEqual(["A", "B"]); expect(data[0]).toEqual({ date: "2026-01-01", A: 60 }); expect(data[1]).toEqual({ date: "2026-01-02", A: 70, B: 90 });
  });
});

describe("theme", () => {
  function Probe() { const { theme, toggle } = useTheme(); return <button onClick={toggle}>theme:{theme}</button>; }
  it("toggles, applies to <html> and persists", async () => {
    localStorage.setItem("crescova-theme", "light");
    renderApp(<Probe />);
    expect(document.documentElement.dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("button"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("crescova-theme")).toBe("dark");
  });
  it("restores the saved theme", () => {
    localStorage.setItem("crescova-theme", "dark");
    renderApp(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("theme:dark");
  });
  it("ThemeProvider is exported for the app shell", () => { expect(ThemeProvider).toBeTypeOf("function"); });
});

describe("navigation", () => {
  it("lists all 14 modules; built ones are links, planned ones are disabled and not links", () => {
    renderApp(<Routes><Route element={<Layout user={user} />}><Route index element={<p>home</p>} /></Route></Routes>);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(NAV).toHaveLength(14);
    for (const it of NAV) {
      if (it.to) expect(within(nav).getByRole("link", { name: it.label })).toHaveAttribute("href", it.to);
      else {
        expect(within(nav).queryByRole("link", { name: new RegExp(it.label) })).toBeNull();
        expect(within(nav).getByText(it.label).closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
      }
    }
  });
  it("collapses the sidebar and remembers it", async () => {
    renderApp(<Routes><Route element={<Layout user={user} />}><Route index element={<p>home</p>} /></Route></Routes>);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(localStorage.getItem("crescova-sidebar")).toBe("1");
  });
});

describe("login", () => {
  it("rejects short passwords on register without calling the API", async () => {
    const calls = mockApi({});
    renderApp(<Login />);
    await userEvent.click(screen.getByRole("button", { name: "Create a workspace" }));
    await userEvent.type(screen.getByLabelText("Your name"), "Ada");
    await userEvent.type(screen.getByLabelText("Agency name"), "Acme");
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText(/^Password/), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 10");
    expect(calls).toHaveLength(0);
  });
  it("shows the server's message on bad credentials", async () => {
    mockApi({ "POST /api/auth/login": () => ({ status: 401, body: { detail: "Incorrect email or password" } }) });
    renderApp(<Login />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
  });
});

describe("websites", () => {
  it("shows an empty state, validates the form, then posts the new website", async () => {
    let created = false;
    const calls = mockApi({
      "GET /api/websites": () => ({ body: created ? [site()] : [] }),
      "POST /api/websites": () => { created = true; return { status: 201, body: site() }; },
    });
    renderApp(<ToastProvider><WebsitesPage /></ToastProvider>);
    expect(await screen.findByText("No websites yet")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /Add website/ })[0]);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add website" }));
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText(/valid address/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText("Website name"), "Acme");
    await userEvent.type(within(dialog).getByLabelText("Website URL"), "acme.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add website" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "Acme", url: "acme.com" });
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });

  it("shows server-side URL rejection inside the form", async () => {
    mockApi({ "GET /api/websites": [], "POST /api/websites": () => ({ status: 422, body: { detail: "URL rejected: Private, loopback and link-local addresses are not allowed" } }) });
    renderApp(<WebsitesPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: /Add website/ }))[0]);
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Website name"), "Local");
    await userEvent.type(within(dialog).getByLabelText("Website URL"), "http://192.168.0.1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add website" }));
    expect(await within(dialog).findByText(/Private, loopback/)).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    const calls = mockApi({ "GET /api/websites": [site()], "DELETE /api/websites/1": () => ({ status: 204 }) });
    renderApp(<ToastProvider><WebsitesPage /></ToastProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Acme" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("cannot be undone");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete website" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("overview", () => {
  const base: Overview = { seo: { websites: 0, audits_total: 0, average_score: null, critical_issues: 0, warnings: 0, improvements_completed: 0 }, score_trend: [], audit_activity: [], recent_audits: [], business: emptyBusiness };
  it("prompts to add a website when there is no data and never invents business numbers", async () => {
    mockApi({ "GET /api/dashboard/overview": base });
    renderApp(<OverviewPage />);
    expect(await screen.findByText("Add your first website")).toBeInTheDocument();
    expect(screen.getByText(/No leads or clients yet/)).toBeInTheDocument();
    expect(screen.getByText("Total leads").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Conversion rate").parentElement).toHaveTextContent("—");
  });
  it("renders stored statistics", async () => {
    mockApi({ "GET /api/dashboard/overview": { ...base, seo: { websites: 3, audits_total: 7, average_score: 82.5, critical_issues: 4, warnings: 11, improvements_completed: 5 } } });
    renderApp(<OverviewPage />);
    expect(await screen.findByText("82.5")).toBeInTheDocument();
    expect(screen.getByText("Avg. SEO health").parentElement).toHaveTextContent("82.5");
  });
});

describe("findings & score ring", () => {
  it("expands a finding to show deterministic detail and filters by severity", async () => {
    renderApp(<FindingsList exportName="x" findings={[finding(), finding({ id: 2, severity: "info", name: "HTML lang attribute set", category: "content" })]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /Page has a title/ }));
    expect(screen.getByText("Deterministic finding")).toBeInTheDocument();
    expect(screen.getByText("Write a unique title.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filter by severity"), "info");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("HTML lang attribute set")).toBeInTheDocument();
  });
  it("labels the score ring accessibly", () => {
    renderApp(<><ScoreRing score={87} /><ScoreRing score={null} /></>);
    expect(screen.getByRole("img", { name: "SEO health score 87 out of 100" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "No score yet" })).toBeInTheDocument();
  });
});
