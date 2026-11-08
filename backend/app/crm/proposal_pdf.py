import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def proposal_pdf(p: dict, agency: str, currency: str) -> bytes:
    """p is the ProposalOut dict. All text is escaped; it is user-entered and goes into reportlab markup."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm, title=p["title"], author=agency)
    st = getSampleStyleSheet()
    P = lambda t, s="BodyText": Paragraph(escape(str(t)).replace("\n", "<br/>"), st[s])  # noqa: E731
    money = lambda v: f"{currency} {v:,.2f}"  # noqa: E731

    story = [P(agency, "Heading3"), P(p["title"], "Title"), P(f"Prepared for: {p['recipient_name'] or '—'}")]
    if p["valid_until"]:
        story.append(P(f"Valid until: {p['valid_until']:%d %B %Y}"))
    story.append(Spacer(1, 6 * mm))
    for heading, key in (("Overview", "description"), ("Deliverables", "deliverables"), ("Timeline", "timeline")):
        if p[key]:
            story += [P(heading, "Heading2"), P(p[key]), Spacer(1, 3 * mm)]

    rows = [["Item", "Qty", "Unit price", "Total"]] + [[Paragraph(escape(i["description"]), st["BodyText"]), f"{i['quantity']:g}", money(i["unit_price"]), money(i["line_total"])] for i in p["items"]]
    rows.append(["", "", "Subtotal", money(p["subtotal"])])
    if p["discount_percent"]:
        rows.append(["", "", f"Discount ({p['discount_percent']:g}%)", "-" + money(p["discount_amount"])])
    rows.append(["", "", "Total", money(p["total"])])
    t = Table(rows, colWidths=[85 * mm, 18 * mm, 32 * mm, 32 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("FONTSIZE", (0, 0), (-1, -1), 9),
                           ("LINEBELOW", (0, 0), (-1, len(p["items"])), 0.25, colors.lightgrey), ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold")]))
    story += [P("Investment", "Heading2"), t, Spacer(1, 5 * mm)]
    if p["payment_terms"]:
        story += [P("Payment terms", "Heading2"), P(p["payment_terms"])]
    story += [Spacer(1, 8 * mm), P("This document is a proposal, not an invoice. It becomes binding only when both parties agree in writing.", "Italic")]
    doc.build(story)
    return buf.getvalue()
