# Recomp Coach — Build Spec: Coach-Authored Sessions with Injury Gating

Single consolidated spec. Work through tasks in the stated build order. Show the
data model and gate design for review before writing generator changes.

---

## 1. Context

Recomp Coach is a single-file React PWA (`index.html`) served from GitHub Pages
with a Supabase event-sourced backend.

**Current workflow:** the AI Coach card exports a structured brief → user pastes
it into Claude → user pastes Claude's reply back into "Apply pasted plan" → a
parser extracts a fenced `json` block → the plan applies through safety gates.

**Current plan schema (the entire contract):**

```json
{"template":"...","focus":{"shoulders":"...","arms":"...","chest":"...","back":"...","legs":"...","core":"..."},"sessionMin":60,"calorieDelta":0}
```

Everything else — exercise selection, ordering, set counts, rep ranges, loads,
and which sets get trimmed to fit `sessionMin` — is derived by the session
generator from `template` + `focus`. This is too coarse.

### Observed failures driving this build

| # | Failure | Root cause |
|---|---------|------------|
| 1 | `arms: "specialize"` stacked 6 consecutive sets on EZ-Bar Curl | No per-movement set cap; generator adds volume to existing movements instead of pulling a second movement from the pool |
| 2 | 60-min trimmer cut triceps and hammer curl to 1 set each while protecting all 12 delt sets | Trim priority is hardcoded and ignores focus level |
| 3 | Arms sequenced last, after 12 shoulder sets, despite being the specialized group | Exercise ordering is hardcoded |
| 4 | Reverse Pec-Deck prescribed at 40 lb against a 10 lb logged history | No load sanity check |
| 5 | Barbell Bench Press and Chest-Supported Row visible in Insights but absent from the exported brief | Brief exporter filters the lift set |
| 6 | `totalSessions` reports 141 over 8 weeks (~17/week) | Counter likely counts set or exercise rows, not sessions |
| 7 | Pasting a plan cannot express exercise selection, order, set schemes, or day structure | Schema has four fields |

---

## 2. Governing principle

**Claude proposes, the app disposes, and neither decides what is medically safe.**

Injury constraints are clinician-defined data. An LLM reply must never be able to
modify them, override them, or route around them. Every widening of the schema
below is matched by a gate. The gates are the load-bearing part of this build —
Tasks 6 and 7 must not ship without Task 4 verified.

Risk framing: today, a malformed reply misconfigures a focus label. After this
build, a malformed reply could put 40 lb on a rear delt machine or program a
full-ROM hinge into a hip labral tear. Gates 1–13 plus mandatory diff-and-confirm
are what keep that reversible.

---

## 3. Build order

```
TASK 0  Injury profile as protected data
TASK 1  Exercise library attribute tagging
TASK 4  Safety gates 1–8              ← verify against test cases before proceeding
TASK 5  Fix the coach brief export
TASK 2  Per-exercise prescriptions
TASK 3  Set schemes (back-off / drop)
TASK 6  Full session authorship + gates 9–13 + versioning
TASK 7  Coach framing and evidence grounding
```

Tasks 0, 1, 4 and 5 are prerequisites. Do not enable day authorship (Task 6)
until the gate test suite passes.

---

## TASK 0 — Injury profile as protected, structured data

Injury constraints currently live as prose inside the exported brief. Move them
into a structured record the plan parser can **read but never write**.

```json
{
  "injuryProfile": {
    "recoveringMode": true,
    "injuries": [
      {"id": "hip_labrum", "side": "left", "status": "recovering", "since": "2026-01"},
      {"id": "prox_hamstring_tendinosis", "status": "recovering"}
    ],
    "movementConstraints": {
      "forbidden": ["loaded_deep_hip_flexion", "hip_flexion_beyond_90_loaded"],
      "limited": [
        {"attribute": "squat_depth", "maxValue": "above_parallel", "enforce": "safety_pins"},
        {"attribute": "hinge_rom", "maxValue": "mid_shin"}
      ],
      "painRule": {"threshold": 3, "window24h": true, "action": "reduce_load_pct", "value": 20}
    },
    "clinicianReviewed": false,
    "lastReviewDate": null
  }
}
```

**Requirements**

- Editable **only** from the Settings screen.
- The paste parser has no write path to this object. Enforce structurally — a
  separate store/module with no mutation exported to the parser — not by
  convention or by a validation check the parser itself performs.
- Surface `clinicianReviewed` in the UI. While `false`, show a persistent note
  that the ROM and depth limits have not been signed off by a clinician.
- The brief exporter serializes this record into the outgoing prompt, so Claude
  sees the constraints and rarely proposes something that trips a gate.

---

## TASK 1 — Exercise library: movement attribute tagging

Gates must key on **mechanics, not exercise names**. Name-based blocking fails the
moment a "Deep Goblet Squat" or an unfamiliar alternate appears.

Add to every exercise in the library:

```json
{
  "id": "goblet_box_squat",
  "name": "Goblet / Box Squat",
  "group": "legs",
  "attributes": ["loaded_hip_flexion", "axial_load", "knee_dominant"],
  "romProfile": {"hipFlexionMax": "90", "squatDepth": "above_parallel"},
  "contraindications": ["hip_labrum"],
  "pool": ["legs_quad"]
}
```

Gate logic is a set intersection:

```
if (exercise.attributes ∩ constraints.forbidden) → reject
if (exercise.romProfile[attr] exceeds constraints.limited[attr].maxValue) → reject
```

**Deny by default.** While `recoveringMode` is `true`, any exercise with
incomplete attribute tags is rejected. Untagged means unknown, and unknown near a
labral tear means no. Provide a Settings view listing untagged exercises so the
library can be completed incrementally.

Also tag each exercise with the `pool` it belongs to (e.g. `arms_biceps`,
`arms_triceps`, `shoulders_lateral`) — the generator and Gate 12 need pools to
pull substitute movements.

---

## TASK 2 — Per-exercise prescriptions

Extend the pasted-plan schema with two **optional** keys. Fully backward
compatible: a bare four-field block applies exactly as it does today.

```json
{
  "template": "upperFocus",
  "focus": {"shoulders": "emphasize", "arms": "specialize", "chest": "normal", "back": "normal", "legs": "maintain", "core": "normal"},
  "sessionMin": 60,
  "calorieDelta": 150,
  "prescriptions": [
    {
      "exerciseId": "ezcurl",
      "dayKey": "arms_delts",
      "order": 1,
      "sets": 4,
      "repMin": 10,
      "repMax": 15,
      "load": 35,
      "restSec": 90
    }
  ],
  "sessionRules": {
    "maxSetsPerMovement": 4,
    "orderByFocus": ["specialize", "emphasize", "normal", "maintain"],
    "trimPriority": ["maintain", "normal", "emphasize", "specialize"],
    "weeklyGroupSetCaps": {"shoulders": 20}
  }
}
```

**Requirements**

- Prescriptions are **partial overrides**. Any omitted field falls back to the
  generator's derived value. Omitting `load` means "keep using the bidirectional
  load engine for this lift."
- `orderByFocus` and `trimPriority` are currently hardcoded in the generator —
  extract them into configurable rules. Sequencing puts the `specialize` group
  first; trimming cuts from the lowest-focus group first. Fixes failures 2 and 3.
- `maxSetsPerMovement` caps sets on any single exercise. When the focus level
  calls for more volume than the cap allows, the generator must pull an
  **additional movement** from that muscle's pool rather than exceeding the cap.
  Fixes failure 1.

---

## TASK 3 — Set schemes (back-off and drop sets)

Optional `scheme` object on any prescription or day exercise. Three types:

```json
{"type": "straight"}

{"type": "backoff", "topSets": 2, "backoffSets": 2, "backoffLoadPct": 80}

{"type": "drop", "drops": 1, "dropPct": 20, "appliesTo": "lastSet"}
```

- `backoff` accepts `backoffLoad` (absolute lb) as an alternative to
  `backoffLoadPct`.
- `drop.appliesTo` is `"lastSet"` or `"allSets"`.

**Requirements**

- The logger records **each segment as its own set row** with its own actual
  load, so the e1RM engine and the stall detector are not corrupted by drop-set
  segments.
- Drop segments are **excluded** from weekly hard-set volume counts but
  **included** in fatigue tracking. Document this decision in code comments.
- Session card renders schemes legibly:
  `2 × 15 @ 12.5 lb, then 2 × 15 @ 10 lb`
- Duration estimation accounts for schemes when fitting to `sessionMin`.

---

## TASK 4 — Safety gates 1–8

Every gate **rejects with reason** and never silently drops. Rejections render in
the UI with the specific reason and the value substituted. Silent drops teach the
user to trust output they haven't verified.

| Gate | Rule |
|------|------|
| **1** | **Unknown exerciseId** → reject. |
| **2** | **Injury gate.** While `recoveringMode` is true, reject any exercise whose attributes intersect `movementConstraints.forbidden`, or whose `romProfile` exceeds a `limited` `maxValue`. **Not overridable by a pasted plan under any circumstance** — no bypass flag, no confirmation dialog. |
| **3** | **Load sanity.** Reject any prescribed load more than 15% above the most recent logged load for that exercise. Fall back to logged data and mark the prescription unverified. |
| **4** | **Pain rule.** If the last session for a lift logged pain >3/10, force the 20% load reduction regardless of what the prescription says. |
| **5** | **Pain escalation.** If pain >3/10 occurs on the same movement pattern in 2 of the last 4 sessions, or baseline pain trends upward, stop auto-adjusting that pattern and surface a persistent prompt to consult the treating clinician. The app enforces rules; it does not assess whether an injury is worsening. |
| **6** | **Volume ceiling.** Reject prescriptions pushing any muscle above `weeklyGroupSetCaps`. |
| **7** | **Duration.** If prescriptions exceed `sessionMin`, apply `trimPriority` rather than rejecting the whole plan. |
| **8** | **Deload state** overrides all prescriptions. |

---

## TASK 5 — Fix the coach brief export

- Barbell Bench Press and Chest-Supported Row appear in Insights but are absent
  from the exported metrics. Find the filter and fix it — the brief must reflect
  the full logged set, or the model's volume arithmetic is wrong from the start.
- `totalSessions` reports 141 over 8 weeks. Determine whether it counts sessions
  or set/exercise rows, and correct it.
- Update the brief template to declare the new optional fields, list the movement
  attributes available for constraint matching, and instruct the model to decline
  rather than substitute when no compatible exercise exists.

---

## TASK 6 — Full session authorship

Task 2 lets Claude override parameters on generator-selected exercises. This task
lets Claude author the day itself: exercise **selection, substitution, ordering,
and volume distribution**. The generator becomes the fallback path, not the
primary one.

Add an optional `days` array. When present, it replaces generator selection for
the named days. When absent, the generator runs as today.

```json
{
  "template": "upperFocus",
  "focus": {"shoulders": "emphasize", "arms": "specialize", "chest": "normal", "back": "normal", "legs": "maintain", "core": "normal"},
  "sessionMin": 60,
  "calorieDelta": 150,
  "splitPattern": "UULU",
  "days": [
    {
      "dayKey": "arms_delts",
      "label": "Arms + Delts",
      "targetMin": 60,
      "exercises": [
        {"exerciseId": "ezcurl", "order": 1, "sets": 4, "repMin": 10, "repMax": 15, "load": 35, "restSec": 90,
         "scheme": {"type": "straight"},
         "rationale": "Specialize group sequenced first; capped at 4 sets per movement"},
        {"exerciseId": "skullcrusher", "order": 2, "sets": 4, "repMin": 10, "repMax": 15,
         "rationale": "Triceps volume >= biceps volume for an arm block"},
        {"exerciseId": "hammer_crossbody", "order": 3, "sets": 3, "repMin": 10, "repMax": 15, "load": 25,
         "rationale": "Second biceps movement rather than a 5th and 6th curl set"},
        {"exerciseId": "cable_lat_raise", "order": 5, "sets": 3, "repMin": 15, "repMax": 20, "load": 10,
         "rationale": "Load reduced from 12.5 — 50% inter-set rep decay on Aug 27"}
      ],
      "estimatedMin": 58,
      "weeklyGroupSets": {"arms": 22, "shoulders": 16}
    }
  ]
}
```

**Requirements**

- **Substitution.** Claude may replace any exercise with another from the library.
  Substitutions run the full gate stack. A substitute failing Gate 2 is rejected
  and the original retained — never silently swapped for something untested.
- **Reordering.** `order` is authoritative when `days` is present.
  `sessionRules.orderByFocus` applies only on the fallback generator path.
- **Rationale required.** Every exercise entry carries a `rationale` string,
  rendered in the session card detail view. An unexplained prescription is one
  you cannot audit.
- **Self-reported totals are verified, not trusted.** `estimatedMin` and
  `weeklyGroupSets` are the model's own arithmetic. The app recomputes both and
  rejects the day if either is off by more than 10%. Surface the discrepancy.
- **Partial application.** If one day fails validation, apply the others and
  report the failure. Never discard a whole plan over one bad day.

### Gates 9–13

| Gate | Rule |
|------|------|
| **9** | Every `exerciseId` in `days` must exist and pass Gates 1–8. |
| **10** | Recomputed session duration must be within 10% of `estimatedMin`. |
| **11** | Recomputed weekly group sets must be within 10% of `weeklyGroupSets` and under `weeklyGroupSetCaps`. |
| **12** | A day must contain at least one exercise per group marked `specialize` or `emphasize`. Reject a day that drops the specialized group entirely. |
| **13** | Substitutions cannot reduce a `maintain` group below its floor. Maintenance volume is not a source of trimmable sets when it serves a rehab function (RDL, goblet squat, hip thrust). |

### Plan versioning and approval

Full day authorship means output varies between regenerations. Add:

- Every applied plan stored as a **versioned, immutable record** with timestamp
  and the brief that produced it.
- A **diff view before apply**: exercises added, removed, reordered, set and load
  changes, shown against the current plan. User confirms.
- **One-tap revert** to any prior plan version.
- **Never auto-apply** an authored plan. The diff-and-confirm step is mandatory.

---

## TASK 7 — Coach framing and evidence grounding

Rewrite the exported brief's system framing:

> You are an evidence-based strength coach and exercise scientist designing
> training for a specific individual. Design complete sessions: select exercises,
> sequence them, assign sets, rep ranges, loads and rest.
>
> Ground every decision in the research corpus supplied below and cite the
> specific source when it drives a choice. Where the corpus does not cover a
> question, say so rather than asserting. Where the user's stated goals conflict
> with their injury constraints, time budget, or the evidence, say so plainly and
> program for the constraint, not the preference.
>
> You must respect the movement constraints in the injury profile. If no
> compatible exercise exists for a slot, leave it out and explain why — never
> substitute an exercise you cannot verify against the constraint list.

**The framing is not what makes the output evidence-based — the payload is.** The
brief must include, structured:

- the full `injuryProfile` record and the available movement attributes
- the embedded research corpus, **all 21 entries, not a subset**
- complete per-lift logged history — every lift shown in Insights (see Task 5)
- the session time budget and current split pattern
- the **full exercise library the model may select from, with attribute tags**, so
  it can constraint-check its own selections before proposing them

Selecting from a bounded, tagged library is what prevents the model from
recalling exercises out of training data that have never been validated against
the injury profile.

---

## Test suite (required)

Unit tests for every gate, including at minimum:

1. Reverse Pec-Deck prescribed at 40 lb against a 10 lb logged history → Gate 3
   rejects, falls back to logged load, surfaces the reason.
2. 6 sets prescribed on a single movement with `maxSetsPerMovement: 4` → capped;
   overflow volume spawns a second movement from the same pool.
3. A forbidden-attribute exercise arriving via `prescriptions` → Gate 2 rejects.
4. A forbidden-attribute exercise arriving via `days` substitution → Gate 9/2
   rejects, original retained.
5. An untagged exercise while `recoveringMode` is true → deny by default.
6. A pasted plan attempting to modify `injuryProfile` → **structurally
   impossible**; assert the parser exposes no write path.
7. `estimatedMin` understated by 30% → Gate 10 rejects the day, other days apply.
8. A day omitting the `specialize` group entirely → Gate 12 rejects.
9. A trim that would cut RDL / goblet squat / hip thrust below the maintain floor
   → Gate 13 rejects.
10. Legacy four-field plan block → applies unchanged, no regression.

---

## Deliverables

- `injuryProfile` store with enforced write isolation from the parser
- Exercise library attribute schema plus a tagging coverage report
- Extended plan schema, documented with a worked example in the AI Coach help text
- Parser handling legacy and extended formats
- All 13 gates implemented, with the test suite above passing
- Plan versioning, diff view, and revert
- Updated brief exporter (full lift set, corrected session count, full corpus,
  tagged library)
- Migration note: existing saved plans keep working untouched

---

## Open item — not a code task

Gate 2 and Task 0 enforce whatever depth and ROM values are entered in the
constraint record. The above-parallel squat stop and mid-shin hinge limits should
be confirmed by the clinician managing the hip, not derived from the app's
research corpus. Until they are, set `clinicianReviewed: false` and leave the UI
notice visible. Precise enforcement of unverified limits is still unverified.
