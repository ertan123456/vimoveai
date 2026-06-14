# app/program_engine.py — rule-based exercise program generator
#
# Loads the evidence-based knowledge base (data/programs.json) and produces a
# personalized program from (condition + age + gender).
#
# Design notes:
#  - Exercises are limited to movements the in-browser AI can reliably detect.
#  - Rep targets are evidence-INFORMED starting points, individualized by age
#    (ACSM individualized-progression principle), to be refined with a clinician.
#  - Gender is recorded but does NOT change exercise selection: current evidence
#    does not support gender-specific selection for these conditions.
from __future__ import annotations

from pathlib import Path
import json

DATA_FILE = Path(__file__).resolve().parent / "data" / "programs.json"

with DATA_FILE.open(encoding="utf-8") as _f:
    _DB = json.load(_f)

_SIDE_LABEL = {"left": "Left", "right": "Right"}


def _tier(age: int) -> dict:
    for t in _DB["age_scaling"]["tiers"]:
        if age <= t["max_age"]:
            return t
    return _DB["age_scaling"]["tiers"][-1]


def list_conditions() -> list[dict]:
    """Active conditions for the setup form / nav (all conditions in the DB)."""
    return [{"slug": slug, "name": c["name"], "active": True}
            for slug, c in _DB["conditions"].items()]


def all_conditions() -> dict:
    return _DB["conditions"]


def get_condition(slug: str):
    return _DB["conditions"].get(slug)


def _display_name(ex: dict, side) -> str:
    if side is None:
        return ex["name"]
    return f"{_SIDE_LABEL[side]} {ex['name']}"


def build_program(disease: str, age, gender: str | None = None):
    """Return a personalized program dict, or None for an unknown condition."""
    cond = _DB["conditions"].get((disease or "").lower().strip())
    if not cond:
        return None

    try:
        age = int(age)
    except (TypeError, ValueError):
        age = 65

    tier = _tier(age)
    factor = tier["rep_factor"]
    min_reps = _DB["age_scaling"]["min_reps"]

    by_id = {e["id"]: e for e in cond["exercises"]}
    plan = []
    for ex_id in cond["order"]:
        ex = by_id.get(ex_id)
        if not ex:
            continue
        reps = max(min_reps, round(ex["base_reps"] * factor))
        for side in ex["sides"]:
            plan.append({
                "ad": _display_name(ex, side),
                "hedef": reps,
                "kind": ex["kind"],
                "side": side,
                "domain": ex["domain"],
                "rationale": ex["rationale"],
            })

    return {
        "disease": disease,
        "name": cond["name"],
        "name_tr": cond.get("name_tr", cond["name"]),
        "summary": cond["summary"],
        "summary_tr": cond.get("summary_tr", cond["summary"]),
        "principles": cond["principles"],
        "sources": cond["sources"],
        "difficulty": tier["label"],
        "age": age,
        "gender": gender,
        "total_exercises": len(plan),
        "exercises": plan,
    }
