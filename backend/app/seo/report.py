"""Audit exports: CSV, JSON and a PDF report. Everything shown is stored deterministic data."""
import csv
import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..models import SeoAudit, SeoFinding, Website
from .checks import CATEGORIES

SEV_ORDER = {"critical": 0, "warning": 1, "info": 2}


def findings_csv(findings: list[SeoFinding]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["severity", "category", "issue", "url", "explanation", "why_it_matters", "recommendation", "evidence"])
    for f in findings:
        # Prefix cells starting with formula characters so spreadsheets don't execute site-supplied text.
        cells = [f.severity, f.category, f.name, f.url, f.explanation, f.why_it_matters, f.recommendation, f.evidence]
        w.writerow([("'" + c if c[:1] in "=+-@\t\r" and c else c) for c in cells])
    return buf.getvalue()


def audit_pdf(site: Website, audit: SeoAudit, findings: list[SeoFinding]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"SEO audit – {site.name}")
    st = getSampleStyleSheet()
    small = st["BodyText"].clone("small", fontSize=8, leading=10)
    P = lambda t, s=None: Paragraph(escape(str(t)), s or st["BodyText"])  # noqa: E731  (escape: site content is untrusted)
    story = [
        P("Crescova Intelligence – SEO Audit Report", st["Title"]),
        P(f"{site.name} · {site.url}"),
        P(f"Audited {audit.finished_at:%d %b %Y %H:%M} UTC · {audit.pages_crawled} page(s) crawled · mode: {audit.mode}"),
        Spacer(1, 6 * mm),
        P(f"SEO Health Score: {audit.score if audit.score is not None else 'n/a'} / 100", st["Heading2"]),
        P(f"{audit.critical_count} critical · {audit.warning_count} warnings · {audit.info_count} opportunities · {audit.passed_count} checks passed"),
        Spacer(1, 4 * mm),
    ]
    rows = [["Category", "Weight", "Score"]] + [
        [CATEGORIES.get(c, c), f"{audit.weights.get(c, 0):g}%", "n/a" if s is None else f"{s:g}"] for c, s in audit.category_scores.items()
    ]
    t = Table(rows, colWidths=[90 * mm, 30 * mm, 30 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    story += [t, Spacer(1, 3 * mm),
              P("The SEO Health Score is Crescova's own diagnostic metric derived from the deterministic checks in this report. "
                "It is not a Google ranking factor and does not predict rankings.", small), Spacer(1, 6 * mm),
              P("Findings", st["Heading2"])]
    ordered = sorted(findings, key=lambda f: (SEV_ORDER.get(f.severity, 9), f.name, f.url))[:150]
    for f in ordered:
        story += [P(f"[{f.severity.upper()}] {f.name}", st["Heading4"]), P(f.url, small), P(f.explanation, small),
                  P(f"Fix: {f.recommendation}", small)]
        if f.evidence:
            story.append(P(f"Evidence: {f.evidence}", small))
        story.append(Spacer(1, 2 * mm))
    if len(findings) > len(ordered):
        story.append(P(f"… {len(findings) - len(ordered)} further findings are available in the CSV/JSON export.", small))
    doc.build(story)
    return buf.getvalue()
