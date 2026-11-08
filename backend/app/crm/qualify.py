"""Rules-based lead qualification. This is NOT AI: it is a transparent checklist over what is recorded on the lead
and the agency's own pricing packages. It only suggests; it never changes a lead's status or rejects anyone.
The AI-assisted variant (Phase C) is meant to return the same shape with source="ai"."""
import re
from datetime import datetime

HIGH_INTENT = ("urgent", "asap", "this month", "next week", "ready to", "quote", "proposal", "start now", "immediately", "budget approved")
LOW_INTENT = ("just looking", "just browsing", "researching", "no rush", "someday", "information only", "curious")


STOPWORDS = {"the", "and", "for", "with", "our", "you", "your", "are", "need", "needs", "want", "from", "this", "that", "have", "will", "about", "service", "services"}


def _tokens(text: str) -> set[str]:
    # 3+ characters so "seo", "ppc" and "ads" count; common filler words don't
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) >= 3 and t not in STOPWORDS}


def qualify(lead, packages: list, now: datetime) -> dict:
    """lead: any object with the Lead attributes; packages: the agency's active PricingPackage rows."""
    signals: list[dict] = []
    score = 0

    def sig(label: str, points: int):
        nonlocal score
        score += points
        signals.append({"label": label, "points": points})

    has_contact = bool(lead.email or lead.phone)
    sig("Has an email or phone number" if has_contact else "No email or phone recorded", 1 if has_contact else 0)
    sig("Has a website" if lead.website else "No website recorded", 1 if lead.website else 0)

    text = f"{lead.service_interest} {lead.notes}".lower()
    cheapest = min((p.price for p in packages if p.price > 0), default=None)
    if lead.budget is None:
        sig("Budget not provided", 0)
    else:
        sig("Budget provided", 1)
        if cheapest is None:
            signals.append({"label": "No priced packages configured, so budget fit can't be judged", "points": 0})
        elif lead.budget >= cheapest:
            sig("Budget covers the lowest-priced package", 2)
        else:
            sig("Budget is below the lowest-priced package", -1)

    wanted = _tokens(f"{lead.service_interest} {lead.notes}")
    fit = [p.name for p in packages if wanted & _tokens(f"{p.name} {p.description}")]
    if fit:
        sig(f"Interest matches {len(fit)} package(s)", 1)
    elif not packages:
        signals.append({"label": "No pricing packages configured, so service fit can't be assessed", "points": 0})
    else:
        sig("No package matches the stated interest", 0)

    high, low = any(k in text for k in HIGH_INTENT), any(k in text for k in LOW_INTENT)
    if high and not low:
        sig("Notes suggest urgency or readiness to buy", 2)
    elif low:
        sig("Notes suggest low urgency", -1)

    priority = "high" if score >= 5 else "medium" if score >= 3 else "low"

    if not has_contact:
        action = "Find a way to reach this lead: no email or phone is recorded."
    elif lead.status == "new":
        action = "Make first contact (aim for one business day) and confirm what they need."
    elif lead.budget is None:
        action = "Ask about budget before preparing a proposal."
    elif priority == "high" and lead.status in ("contacted", "qualified"):
        action = "Book a discovery call and prepare a proposal."
    else:
        action = "Send a short follow-up and agree a next step with a date."

    questions = []
    if lead.budget is None:
        questions.append("What budget range have you set aside for this?")
    if not lead.service_interest:
        questions.append("Which services are you most interested in?")
    if not lead.website:
        questions.append("Do you have an existing website we can review?")
    if not (high or low):
        questions.append("When would you like to get started?")
    questions.append("What would a successful result look like for you?")

    who = lead.name + (f" ({lead.company})" if lead.company else "")
    return {
        "source": "rules",
        "label": "Rules-based assessment, not AI",
        "generated_at": now.isoformat(),
        "suggested_priority": priority,
        "score": score,
        "signals": signals,
        "service_fit": fit,
        "summary": f"{who} is interested in {lead.service_interest or 'an unspecified service'}. "
                   f"Score {score} gives a suggested priority of {priority}.",
        "next_action": action,
        "follow_up_questions": questions,
    }
