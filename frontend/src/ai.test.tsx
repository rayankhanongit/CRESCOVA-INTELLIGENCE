import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "./components/ui";
import Recommendations from "./components/Recommendations";
import type { CompetitiveView, Competitor, ContentEntry, KeywordRow, Recommendation, SiteSummary, SystemStatus, Website } from "./lib/types";
import CompetitorsPage from "./pages/Competitors";
import ContentStudio from "./pages/ContentStudio";
import KeywordsPage from "./pages/Keywords";
import { mockApi, renderApp } from "./test-utils";

const status = (configured: boolean): Partial<SystemStatus> => ({ ai: { configured, provider: configured ? "groq" : "none", model: configured ? "m-1" : "" } });
const site: Website = { id: 1, name: "Acme", url: "https://acme.com/", category: "", target_audience: "", market: "", platform: "", description: "", created_at: "2026-01-01T00:00:00Z", last_audit_at: null, current_score: null };
const rec = (o: Partial<Recommendation> = {}): Recommendation => ({ id: 1, audit_id: 4, check_id: "title_present", check_name: "Page has a title", severity: "critical", interpretation: "Pages lack titles.", recommendation: "Write unique titles.", example: "", status: "suggested", provider: "groq", model: "m-1", ...o });
const kw = (o: Partial<KeywordRow> = {}): KeywordRow => ({ id: 1, term: "emergency plumber", website_id: null, intent: "transactional", topic: "Urgent", mapped_url: "", source: "manual", search_volume: null, difficulty: null, cpc: null, position: null, metrics_source: "", notes: "", ...o });
const summary = (o: Partial<SiteSummary> = {}): SiteSummary => ({ pages_analysed: 5, avg_word_count: 420, pct_with_title: 100, pct_with_description: 80, pct_with_h1: 100, pct_with_schema: 40, schema_types: { LocalBusiness: 2 }, top_terms: ["boiler"], sample_titles: [], site: { https: true, robots: true, sitemap: false, sitemap_urls: 0, blocked_by_robots: false }, ...o });

describe("AI recommendations", () => {
  const wrap = () => renderApp(<ToastProvider><Recommendations auditId={4} /></ToastProvider>);

  it("is disabled with an explanation when no AI provider is configured", async () => {
    mockApi({ "GET /api/system/status": status(false), "GET /api/audits/4/recommendations": [] });
    wrap();
    const btn = await screen.findByRole("button", { name: /Generate recommendations/ });
    await waitFor(() => expect(screen.getByText(/AI is not configured \(set an API key/)).toBeInTheDocument());
    expect(btn).toBeDisabled();
    expect(screen.getByText("AI-generated")).toBeInTheDocument();
  });

  it("generates, labels, and records a review decision without touching findings", async () => {
    let generated = false;
    const calls = mockApi({
      "GET /api/system/status": status(true),
      "GET /api/audits/4/recommendations": () => ({ body: generated ? [rec()] : [] }),
      "POST /api/audits/4/recommendations": () => { generated = true; return { status: 201, body: [rec()] }; },
      "PATCH /api/recommendations/1": () => ({ body: rec({ status: "accepted" }) }),
    });
    wrap();
    const btn = await screen.findByRole("button", { name: /Generate recommendations/ });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(await screen.findByText("Write unique titles.")).toBeInTheDocument();
    expect(screen.getByText("groq · m-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Accept/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "accepted" });
    expect(calls.every((c) => !c.path.includes("/websites/"))).toBe(true);
  });
});

describe("keywords", () => {
  const base = { "GET /api/websites": [site], "GET /api/system/status": status(true) };

  it("shows only user-entered metrics and a blank for the rest", async () => {
    mockApi({ ...base, "GET /api/keywords": [kw({ search_volume: 900, metrics_source: "Search Console" }), kw({ id: 2, term: "boiler repair", topic: "Urgent" })] });
    renderApp(<ToastProvider><KeywordsPage /></ToastProvider>);
    const row = (await screen.findByText("emergency plumber")).closest("tr")!;
    expect(within(row).getByText("900")).toBeInTheDocument();
    expect(within(row).getByText("Search Console")).toBeInTheDocument();
    const blank = screen.getByText("boiler repair").closest("tr")!;
    expect(within(blank).getAllByText("—").length).toBeGreaterThanOrEqual(5);
  });

  it("suggests with a no-metrics warning and saves picked ideas as AI estimates without numbers", async () => {
    const calls = mockApi({
      ...base, "GET /api/keywords": [],
      "POST /api/keywords/suggest": () => ({ status: 200, body: { suggestions: [{ term: "boiler service", intent: "commercial", topic: "Boilers", rationale: "high intent" }, { term: "what is a combi boiler", intent: "informational", topic: "Boilers", rationale: "" }], label: "x" } }),
      "POST /api/keywords/bulk": () => ({ status: 201, body: [] }),
    });
    renderApp(<ToastProvider><KeywordsPage /></ToastProvider>);
    const open = await screen.findByRole("button", { name: /Suggest with AI/ });
    await waitFor(() => expect(open).toBeEnabled());
    await userEvent.click(open);
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/no search volume, difficulty, CPC or ranking data/)).toBeInTheDocument();
    await userEvent.type(within(dlg).getByPlaceholderText("plumber, boiler repair"), "boiler");
    await userEvent.click(within(dlg).getByRole("button", { name: /Generate suggestions/ }));
    await userEvent.click(await within(dlg).findByLabelText("Select what is a combi boiler"));  // untick one
    await userEvent.click(within(dlg).getByRole("button", { name: "Save 1 selected" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/keywords/bulk")).toBe(true));
    const sent = calls.find((c) => c.path === "/api/keywords/bulk")!.body.keywords;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ term: "boiler service", intent: "commercial", source: "ai_estimate" });
    expect(Object.keys(sent[0])).not.toEqual(expect.arrayContaining(["search_volume"]));
  });

  it("disables AI suggestions when AI is unconfigured but still allows manual entry", async () => {
    mockApi({ ...base, "GET /api/system/status": status(false), "GET /api/keywords": [] });
    renderApp(<ToastProvider><KeywordsPage /></ToastProvider>);
    expect(await screen.findByRole("note")).toHaveTextContent("AI is not configured");
    expect(screen.getByRole("button", { name: /Suggest with AI/ })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /Add keyword/ })[0]).toBeEnabled();
  });
});

describe("competitors", () => {
  const comp = (o: Partial<Competitor> = {}): Competitor => ({ id: 7, website_id: 1, name: "Rival Heating", url: "https://rival.com/", status: "done", last_analysed_at: "2026-01-01T00:00:00Z", analysis: summary(), insights: null, error: null, ...o });
  const view = (own: SiteSummary | null): CompetitiveView => ({ website: { id: 1, name: "Acme" }, own, own_audit_id: own ? 3 : null, note: "Public page facts only. No competitor analytics, backlinks or rankings are available to this tool.",
    competitors: [{ id: 7, name: "Rival Heating", analysis: summary({ pct_with_schema: 100 }), content_gaps: own ? ["boiler", "landlord"] : [] }] });
  const base = { "GET /api/websites": [site], "GET /api/system/status": status(true), "GET /api/websites/1/competitors": [comp()] };

  it("shows observed facts, content gaps, and a clearly separate AI section", async () => {
    mockApi({ ...base, "GET /api/websites/1/comparison": view(summary()) });
    renderApp(<ToastProvider><CompetitorsPage /></ToastProvider>);
    expect(await screen.findByText("Observed comparison")).toBeInTheDocument();
    expect(await screen.findByText("boiler")).toBeInTheDocument();
    expect(screen.getByText(/We have no access to competitors' analytics, backlinks or rankings/)).toBeInTheDocument();
    expect(screen.getByText("AI interpretation")).toBeInTheDocument();
    expect(screen.getByText(/Not measured data/)).toBeInTheDocument();
    const gen = screen.getByRole("button", { name: /Generate insights/ });
    await waitFor(() => expect(gen).toBeEnabled());
  });

  it("explains that your own audit is needed before comparing or asking AI", async () => {
    mockApi({ ...base, "GET /api/websites/1/comparison": view(null) });
    renderApp(<ToastProvider><CompetitorsPage /></ToastProvider>);
    expect(await screen.findByText(/Run a full-site audit of Acme/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate insights/ })).toBeDisabled();
  });

  it("shows the server's rejection when the competitor URL is private", async () => {
    mockApi({ ...base, "GET /api/websites/1/competitors": [], "GET /api/websites/1/comparison": view(null),
      "POST /api/websites/1/competitors": () => ({ status: 422, body: { detail: "URL rejected: Private, loopback and link-local addresses are not allowed" } }) });
    renderApp(<ToastProvider><CompetitorsPage /></ToastProvider>);
    await userEvent.click((await screen.findAllByRole("button", { name: /Add competitor/ }))[0]);
    const dlg = screen.getByRole("dialog");
    await userEvent.type(within(dlg).getByLabelText(/^Name/), "Local");
    await userEvent.type(within(dlg).getByLabelText(/Website URL/), "http://192.168.0.1");
    await userEvent.click(within(dlg).getByRole("button", { name: "Add competitor" }));
    expect(await within(dlg).findByText(/Private, loopback/)).toBeInTheDocument();
  });
});

describe("content studio", () => {
  const saved: ContentEntry = { id: 2, title: "Old FAQ", kind: "faq", platform: "", body: "Q A", params: {}, ai_generated: true, status: "draft", client_id: null, publish_date: null };
  const base = { "GET /api/clients": [], "GET /api/content": [saved] };

  it("generates editable text, revises it with the previous draft, and saves it flagged as AI-generated", async () => {
    const calls = mockApi({
      ...base, "GET /api/system/status": status(true),
      "POST /api/content/generate": (init?: RequestInit) => ({ body: { text: JSON.parse(String(init?.body)).revise_instruction ? "Shorter version." : "First draft.", ai_generated: true } }),
      "POST /api/content": () => ({ status: 201, body: saved }),
    });
    renderApp(<ToastProvider><ContentStudio /></ToastProvider>);
    await userEvent.type(await screen.findByLabelText("Topic *"), "boiler servicing");
    const gen = screen.getByRole("button", { name: "Generate" });
    await waitFor(() => expect(gen).toBeEnabled());
    await userEvent.click(gen);
    const draft = await screen.findByLabelText("Draft text");
    await waitFor(() => expect(draft).toHaveValue("First draft."));
    expect(screen.getByText(/AI-generated. Check facts/)).toBeInTheDocument();

    await userEvent.type(draft, " My edit.");  // fully editable
    await userEvent.type(screen.getByLabelText("Revise with AI"), "make it shorter");
    await userEvent.click(screen.getByRole("button", { name: /Revise/ }));
    await waitFor(() => expect(draft).toHaveValue("Shorter version."));
    const revise = calls.filter((c) => c.path === "/api/content/generate")[1].body;
    expect(revise).toMatchObject({ previous_text: "First draft. My edit.", revise_instruction: "make it shorter" });

    await userEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/content")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/content")?.body).toMatchObject({ body: "Shorter version.", ai_generated: true, status: "draft", kind: "blog_article" });
  });

  it("lets you write and save by hand when AI is not configured, and never offers publishing", async () => {
    const calls = mockApi({ ...base, "GET /api/system/status": status(false), "POST /api/content": () => ({ status: 201, body: saved }) });
    renderApp(<ToastProvider><ContentStudio /></ToastProvider>);
    expect(await screen.findByRole("note")).toHaveTextContent("AI is not configured");
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Draft text"), "My own copy");
    await userEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ body: "My own copy", ai_generated: false }));
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
  });
});
