"""Report exports from the stored snapshot: CSV, JSON and PDF."""
import csv
import io
import json
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

LABELS = {"seo": "SEO audit", "keywords": "Keywords", "tasks": "Tasks", "recommendations": "Recommendations (AI-generated, reviewed)", "progress": "Project progress", "content": "Content", "notes": "Notes"}
SAFE = lambda v: ("'" + v) if isinstance(v, str) and v[:1] in "=+-@\t\r" and v else v  # noqa: E731  spreadsheet formula guard


def flatten(report) -> list[list]:
    """(section, item, value, source) rows for CSV."""
    rows: list[list] = []
    for name, sec in report.data.get("sections", {}).items():
        src = sec.get("source", "")
        add = lambda item, value: rows.append([name, item, "" if value is None else value, src])  # noqa: E731
        if name == "seo":
            for k in ("audits_run", "full_site_audits", "latest_audit_date", "score", "first_score", "score_change", "pages_crawled", "critical", "warnings", "opportunities", "checks_passed", "note"):
                if k in sec:
                    add(k, sec[k])
            for c, v in (sec.get("category_scores") or {}).items():
                add(f"category_score:{c}", v)
            for i in sec.get("open_issues", []):
                add(f"open_issue:{i['severity']}", f"{i['issue']} ({i['affected_urls']} URLs)")
            for t in ("resolved", "new"):
                for i in sec.get(t, []):
                    add(f"{t}_issue", i)
        elif name == "keywords":
            for k in sec["items"]:
                add(f"keyword:{k['term']}", f"intent={k['intent']}; volume={k['search_volume']}; difficulty={k['difficulty']}; cpc={k['cpc']}; position={k['position']}; metrics_source={k['metrics_source']}; origin={k['origin']}")
        elif name == "tasks":
            add("open", sec["open"])
            add("overdue", sec["overdue"])
            for t in sec["completed_in_period"]:
                add("completed", f"{t['title']} ({t['completed']})")
        elif name == "recommendations":
            for r in sec["items"]:
                add(f"ai_recommendation:{r['issue']}", r["recommendation"])
        elif name == "progress":
            add("client_status", sec["client_status"])
            add("onboarding", f"{sec['onboarding_done']}/{sec['onboarding_total']}")
        elif name == "content":
            for e in sec["items"]:
                add(f"content:{e['date']}", f"{e['title']} [{e['platform']}; {e['status']}{'; AI-assisted' if e['ai_assisted'] else ''}]")
        elif name == "notes":
            add("summary", sec["text"])
    return rows


def to_csv(report) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "item", "value", "data_source"])
    for row in flatten(report):
        w.writerow([SAFE(c) for c in row])
    return buf.getvalue()


def to_json(report) -> str:
    return json.dumps({"title": report.title, "period_start": str(report.period_start), "period_end": str(report.period_end), **report.data}, indent=2, default=str)


def to_pdf(report, agency: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=report.title, author=agency)
    st = getSampleStyleSheet()
    P = lambda t, s="BodyText": Paragraph(escape(str(t)).replace("\n", "<br/>"), st[s] if isinstance(s, str) else s)  # noqa: E731  (s: style name or style)
    small = st["BodyText"].clone("small", fontSize=8, leading=10, textColor=colors.HexColor("#555555"))
    meta = report.data["meta"]
    story = [P(agency, "Heading3"), P(report.title, "Title"), P(f"Period: {report.period_start:%d %b %Y} to {report.period_end:%d %b %Y}")]
    for k in ("website", "client"):
        if meta.get(k):
            story.append(P(f"{k.capitalize()}: {meta[k]['name']}"))
    story.append(Spacer(1, 4 * mm))

    def table(rows, widths):
        t = Table(rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
        return t
    cell = lambda t: Paragraph(escape(str(t)), st["BodyText"].clone("c", fontSize=8, leading=10))  # noqa: E731

    for name, sec in report.data["sections"].items():
        story += [P(LABELS[name], "Heading2"), P(f"Data source: {sec['source']}", small)]
        if name == "seo":
            if "note" in sec:
                story.append(P(sec["note"]))
                continue
            story.append(P(f"SEO Health Score: {sec['score']} / 100 (Crescova's own diagnostic score, not a Google ranking factor). {sec['pages_crawled']} pages crawled. "
                           f"{sec['critical']} critical, {sec['warnings']} warnings, {sec['opportunities']} opportunities, {sec['checks_passed']} checks passed."))
            if "score_change" in sec:
                story.append(P(f"Change since {sec['first_audit_date']}: {sec['score_change']:+g} points. Resolved: {len(sec['resolved'])}. New: {len(sec['new'])}."))
            if sec["open_issues"]:
                story.append(table([["Issue", "Severity", "URLs"]] + [[cell(i["issue"]), i["severity"], i["affected_urls"]] for i in sec["open_issues"]], [100 * mm, 30 * mm, 20 * mm]))
        elif name == "keywords":
            story.append(table([["Keyword", "Intent", "Volume", "Position", "Metrics source"]] + [[cell(k["term"]), k["intent"], k["search_volume"] if k["search_volume"] is not None else "n/a",
                                k["position"] if k["position"] is not None else "n/a", cell(k["metrics_source"] or k["origin"])] for k in sec["items"]], [55 * mm, 28 * mm, 20 * mm, 20 * mm, 45 * mm]) if sec["items"] else P("No keywords recorded."))
        elif name == "tasks":
            story.append(P(f"{sec['open']} open, {sec['overdue']} overdue. Completed in this period: {len(sec['completed_in_period'])}."))
            story += [P(f"- {t['title']} ({t['completed']})") for t in sec["completed_in_period"][:40]]
        elif name == "recommendations":
            story += [P(f"{r['issue']}: {r['recommendation']}") for r in sec["items"]] or [P("No accepted recommendations in this period.")]
        elif name == "progress":
            story.append(P(f"Status: {sec['client_status']}. Onboarding: {sec['onboarding_done']} of {sec['onboarding_total']} items done."))
        elif name == "content":
            story += [P(f"{e['date']} - {e['title']} ({e['platform'] or 'n/a'}, {e['status']}{', AI-assisted' if e['ai_assisted'] else ''})") for e in sec["items"]] or [P("No content scheduled in this period.")]
        elif name == "notes":
            story.append(P(sec["text"]))
    if report.data.get("skipped"):
        story += [P("Not included", "Heading2")] + [P(s, "BodyText") for s in report.data["skipped"]]
    story += [Spacer(1, 6 * mm), P("Integrations", "Heading2")] + [P(f"{k.replace('_', ' ').title()}: {v}", small) for k, v in report.data["integrations"].items()]
    doc.build(story)
    return buf.getvalue()
