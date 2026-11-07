"""Transparent scoring. Crescova's SEO Health Score is our own diagnostic metric, NOT a Google ranking factor.

check score    = passed outcomes / applicable outcomes            (0..1)
category score = sum(severity_weight * check score) / sum(severity_weight) * 100   over checks with outcomes
overall score  = sum(category_weight * category score) / sum(category_weight)      over categories with data
severity weights: critical 3, warning 2, info 1.  Category weights are configurable (SEO_CATEGORY_WEIGHTS).
"""
from collections import defaultdict
from dataclasses import dataclass, field

from .checks import CHECKS, SEVERITY_WEIGHT, Outcome


@dataclass
class ScoreResult:
    overall: float | None
    categories: dict[str, float | None] = field(default_factory=dict)
    checks: dict[str, dict] = field(default_factory=dict)  # id -> {passed, total, rate}


def _round(x: float) -> float:
    return round(x, 1)


def compute_scores(outcomes: list[Outcome], weights: dict[str, float]) -> ScoreResult:
    per_check: dict[str, list[bool]] = defaultdict(list)
    for o in outcomes:
        per_check[o.check_id].append(o.passed)

    cat_num: dict[str, float] = defaultdict(float)
    cat_den: dict[str, float] = defaultdict(float)
    checks: dict[str, dict] = {}
    for cid, results in per_check.items():
        d = CHECKS[cid]
        rate = sum(results) / len(results)
        w = SEVERITY_WEIGHT[d.severity]
        cat_num[d.category] += w * rate
        cat_den[d.category] += w
        checks[cid] = {"passed": sum(results), "total": len(results), "rate": round(rate, 4)}

    cats = {c: (_round(cat_num[c] / cat_den[c] * 100) if cat_den[c] else None) for c in weights}
    scored = {c: s for c, s in cats.items() if s is not None and weights[c] > 0}
    total_w = sum(weights[c] for c in scored)
    overall = _round(sum(weights[c] * s for c, s in scored.items()) / total_w) if total_w else None
    return ScoreResult(overall=overall, categories=cats, checks=checks)


def page_score(outcomes: list[Outcome]) -> float | None:
    """Severity-weighted pass rate over a single page's outcomes."""
    num = den = 0.0
    for o in outcomes:
        w = SEVERITY_WEIGHT[CHECKS[o.check_id].severity]
        den += w
        num += w if o.passed else 0
    return _round(num / den * 100) if den else None
