"""Conservative target comparisons from verified, approved evidence; no model arithmetic.

Supported references are explicit single-group target statements with a matching
aggregation and metric. Tables, ranges, temporal qualifiers and implicit targets
are deliberately left as limitations rather than guessed.
"""

import math
import re
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

LABELS = {"mean": "average", "sum": "total", "count": "count", "min": "minimum", "max": "maximum"}
OPERATIONS = {
    "mean": "(?:average|mean)",
    "sum": "(?:total|sum)",
    "count": "count",
    "min": "minimum",
    "max": "maximum",
}
NUMBER = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
UNITS = {
    "usd": "USD",
    "us dollars": "USD",
    "$": "USD",
    "eur": "EUR",
    "€": "EUR",
    "inr": "INR",
    "rupees": "INR",
    "₹": "INR",
    "gbp": "GBP",
    "£": "GBP",
    "%": "%",
    "percent": "%",
    "dollars": "dollars",
}
UNIT_PATTERN = "(?:" + "|".join(re.escape(unit) for unit in UNITS) + ")"


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    source_filename: str
    chunk_id: str
    page_number: int | None = None
    location: str | None = None
    excerpt: str
    source_sha256: str | None = None
    evidence_id: str


class VerifiedComparison(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: Literal["document_target_v1"] = "document_target_v1"
    dataset_evidence_id: str
    dataset_version_id: str
    metric_column_id: str
    group_column_id: str
    group_value: str
    operation: Literal["mean", "sum", "count", "min", "max"]
    unit: str | None
    actual_value: float
    target_value: float
    difference: float  # signed actual minus target
    absolute_difference: float
    target_met: bool
    criterion: Literal["at_least"] = "at_least"
    percentage_difference: float | None
    percentage_of_target: float | None
    claim: str
    citations: list[Citation]


def _contains(text: str, value: str) -> bool:
    return bool(re.search(r"(?<!\w)" + re.escape(value) + r"(?!\w)", text, re.I))


def _units(text: str) -> set[str]:
    return {
        UNITS[match.group().casefold()]
        for match in re.finditer(r"(?<!\w)" + UNIT_PATTERN + r"(?!\w)", text, re.I)
    }


def _number(value: Any) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = Decimal(str(value))
    return result if result.is_finite() else None


def _display(value: Decimal, *, percentage=False) -> str:
    # Only percentage presentation is rounded; persisted calculations retain precision.
    rendered = f"{value:,.2f}" if percentage else f"{value:,f}"
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def _target_clauses(excerpt: str, group_expression: str) -> list[str]:
    """Bind consecutive target clauses to an exact heading in this passage only.

    Keep the original excerpt for citations. A blank line, other heading or
    intervening prose ends the heading's scope; never join arbitrary passage text.
    """
    heading = None
    clauses = []
    for line in excerpt.splitlines():
        if re.fullmatch(rf"{group_expression}\s*:", line.strip(), re.I):
            heading = line.strip()
            continue
        if not line.strip():
            heading = None
        # Keep decimal points intact. Scope every target clause so conflicting
        # targets below the same heading all reach the existing ambiguity check.
        for clause in re.split(r";|(?<!\d)[.!?]\s*|(?<=\d)\.(?!\d)\s*", line):
            if not clause.strip():
                continue
            if heading and re.search(r"\btarget\b", clause, re.I):
                clauses.append(f"{heading} {clause.strip()}")
            else:
                heading = None
                clauses.append(clause)
    return clauses


def comparisons_from_verified(
    evidence: list[dict],
    profile: dict,
    question: str,
    approved_document_ids: list[str],
) -> tuple[list[dict], list[str]]:
    if not re.search(r"\b(target|benchmark)\b", question, re.I):
        return [], []
    columns = {item["id"]: item for item in profile.get("columns", [])}
    approved = set(approved_document_ids)
    passages = []
    for item in evidence:
        payload = item.get("payload", {})
        if item.get("verified") is not True or payload.get("tool_name") != "retrieve_documents":
            continue
        for passage in payload.get("result", {}).get("passages", []):
            if passage.get("document_id") in approved:
                try:
                    passages.append(
                        (
                            payload.get("dataset_version_id"),
                            Citation.model_validate(
                                {
                                    **{
                                        key: passage[key]
                                        for key in Citation.model_fields
                                        if key in passage
                                    },
                                    "evidence_id": item["id"],
                                }
                            ),
                        )
                    )
                except ValidationError:
                    continue
    comparisons, limitations = [], []
    for item in evidence:
        payload = item.get("payload", {})
        result = payload.get("result", {})
        if (
            item.get("verified") is not True
            or payload.get("exact") is not True
            or payload.get("tool_name") != "run_grouped_aggregate"
            or payload.get("warnings")
            or result.get("warnings")
        ):
            continue
        groups = result.get("grouping", [])
        operation = result.get("operation")
        metric = result.get("metric") or next(
            (key for key in reversed(result.get("selected_columns", [])) if key not in groups), None
        )
        if (
            len(groups) != 1
            or groups[0] not in columns
            or metric not in columns
            or operation not in LABELS
            or not payload.get("dataset_version_id")
        ):
            continue
        metric_name = columns[metric]["name"]
        if not _contains(question, metric_name):
            continue
        requested_operations = {
            key
            for key, expression in OPERATIONS.items()
            if re.search(r"\b" + expression + r"\b", question, re.I)
        }
        if requested_operations != {operation}:
            continue
        # A plain target implies a minimum for these performance measures. Other
        # measures (e.g. costs, latency) need an explicit directional contract.
        if not re.search(r"\b(profit|revenue|sales)\b", metric_name, re.I):
            limitations.append(f"Target achievement direction is not defined for {metric_name}.")
            continue
        schema_units = _units(metric_name + " " + str(columns[metric].get("unit", "")))
        if columns[metric].get("unit") and not _units(str(columns[metric]["unit"])):
            limitations.append(
                f"The schema unit for {metric_name} is not supported for comparison."
            )
            continue
        metric_expression = re.escape(metric_name)
        expression = rf"{OPERATIONS[operation]}\s+(?:of\s+)?{metric_expression}"
        named_rows = [
            row
            for row in result.get("rows", [])
            if _contains(question, str(row.get(groups[0], "")))
        ]
        for row in named_rows:
            group = str(row[groups[0]])
            actual = _number(row.get("value"))
            if actual is None:
                continue
            # Full-statement matching prevents attaching a different metric, group,
            # period, range or unit to a number elsewhere in the same passage.
            group_expression = (
                rf"(?:the\s+)?{re.escape(group)}(?:\s+"
                rf"{re.escape(columns[groups[0]]['name'])})?(?:'s|’s)?"
            )
            target_expression = rf"(?:target\s+{expression}|{expression}\s+target)"
            pattern = re.compile(
                rf"^{group_expression}\s*[:\-]?\s*(?:has\s+(?:a\s+)?)?"
                rf"{target_expression}\s*(?:is|of|=|:)\s*"
                rf"(?P<prefix>{UNIT_PATTERN})?\s*(?P<value>{NUMBER})"
                rf"\s*(?P<suffix>{UNIT_PATTERN})?\s*$",
                re.I,
            )
            candidates, invalid = [], False
            for source_version, citation in passages:
                if source_version != payload["dataset_version_id"]:
                    continue
                for clause in _target_clauses(citation.excerpt, group_expression):
                    if not (_contains(clause, group) and re.search(r"\btarget\b", clause, re.I)):
                        continue
                    match = pattern.fullmatch(clause.strip())
                    if not match:
                        invalid = True
                        continue
                    # Context can qualify an otherwise bare target (e.g. "all amounts
                    # in thousands" or "quarterly targets"). Do not silently drop it.
                    if _units(citation.excerpt) != schema_units or re.search(
                        r"\b(thousands?|millions?|billions?|quarter\w*|annual\w*|monthly|"
                        r"daily|weekly|year\w*|fiscal|FY\d*|Q[1-4]|currency|units|"
                        r"amounts|figures|percentages?)\b",
                        citation.excerpt,
                        re.I,
                    ):
                        invalid = True
                        continue
                    target_units = _units((match["prefix"] or "") + " " + (match["suffix"] or ""))
                    # Units embedded in the exact metric name apply on both sides.
                    target_units |= _units(metric_name)
                    if target_units != schema_units or len(schema_units) > 1:
                        invalid = True
                        continue
                    candidates.append((Decimal(match["value"].replace(",", "")), citation))
            targets = {value for value, _ in candidates}
            if invalid or len(targets) != 1:
                limitations.append(
                    f"Cannot verify the {group} {LABELS[operation]} {metric_name} comparison: "
                    "the retrieved target is missing, ambiguous, or has incompatible metric, "
                    "aggregation, units or scope. Use an explicit matching target statement."
                )
                continue
            target = targets.pop()
            difference = actual - target
            percentage = difference / target * 100 if target > 0 else None
            achievement = actual / target * 100 if target > 0 else None
            if any(
                not math.isfinite(float(value))
                for value in (actual, target, difference, percentage, achievement)
                if value is not None
            ):
                limitations.append(f"The {group} comparison exceeds the supported numeric range.")
                continue
            claim = (
                f"{group}'s actual {LABELS[operation]} {metric_name} was {_display(actual)} "
                f"against a documented target of {_display(target)}. "
            )
            if difference == 0:
                claim += "The target was met exactly"
            else:
                subject = (
                    "The region" if columns[groups[0]]["name"].casefold() == "region" else group
                )
                claim += (
                    f"{subject} fell short by "
                    if difference < 0
                    else f"{subject} exceeded the target by "
                )
                claim += _display(abs(difference))
                if percentage is not None:
                    direction = "below" if difference < 0 else "above"
                    claim += (
                        f", or {_display(abs(percentage), percentage=True)}% {direction} target"
                    )
            if achievement is not None:
                claim += f", achieving {_display(achievement, percentage=True)}% of its target."
            else:
                claim += ". Percentages are undefined for a zero or negative target."
            citations = {citation.chunk_id: citation for _, citation in candidates}
            comparison = VerifiedComparison(
                dataset_evidence_id=item["id"],
                dataset_version_id=payload["dataset_version_id"],
                metric_column_id=metric,
                group_column_id=groups[0],
                group_value=group,
                operation=operation,
                unit=next(iter(schema_units), None),
                actual_value=float(actual),
                target_value=float(target),
                difference=float(difference),
                absolute_difference=float(abs(difference)),
                target_met=difference >= 0,
                percentage_difference=float(percentage) if percentage is not None else None,
                percentage_of_target=float(achievement) if achievement is not None else None,
                claim=claim,
                citations=list(citations.values()),
            )
            comparisons.append(comparison.model_dump())
    if not comparisons and not limitations:
        limitations.append(
            "No verified comparison is available: a matching grouped result and an "
            "explicit, comparable target passage for the requested group are required."
        )
    # Conflicting dataset computations must not yield competing claims for one target.
    keys = [
        (item["group_column_id"], item["group_value"], item["metric_column_id"], item["operation"])
        for item in comparisons
    ]
    if len(keys) != len(set(keys)):
        return [], ["Multiple dataset results matched the target; the comparison is ambiguous."]
    return comparisons, list(dict.fromkeys(limitations))


def persisted_comparisons(synthesis, evidence, profile, question, approved_document_ids):
    """Only present existing persisted results whose complete provenance still matches.

    Callers supply the owner/run-scoped ledger. Never backfill historical evidence.
    """
    saved = synthesis.get("comparisons", [])
    if not saved:
        return []
    verified, _ = comparisons_from_verified(evidence, profile, question, approved_document_ids)
    return [item for item in saved if item in verified]


def comparison_presentation(synthesis, evidence, profile, question, approved_document_ids):
    """Shared read-only presentation for the Research API and report worker."""
    if not synthesis.get("comparisons"):
        return synthesis
    comparisons = persisted_comparisons(
        synthesis, evidence, profile, question, approved_document_ids
    )
    return {
        **synthesis,
        "comparisons": comparisons,
        "interpretation": " ".join(item["claim"] for item in comparisons)
        or "The stored comparison could not be verified against this investigation's evidence.",
    }
