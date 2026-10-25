# Proposed research notes — NOT in the corpus

**Status: proposals for Sean's review.** Nothing in this file is read by the app, sent in a coach brief, or added to `RESEARCH_CORPUS`. FIX_SPEC.md item 12: "human approval only, never auto-ingested."

To approve a note:
1. Check the citation against the paper itself (title, year, journal, and that the finding matches what the paper says).
2. Edit the wording if needed.
3. Ask for it to be added to `RESEARCH_CORPUS` in `index.html`, in its own commit.

Both notes were drafted from memory of the literature, not from the papers in hand. Treat every citation detail as unverified until you've checked it.

---

## P-01 — Exercise order

Fills a real gap. No current corpus entry is tagged `order`, and the coach brief says so explicitly ("The corpus has NO entry on: order").

```js
{ id:"r25", tags:["order"], topic:"exercise_order", phase:["building","upperFocus","superhero","all"],
  finding:"Exercises performed earlier in a session sustain more repetitions and, over a training block, tend to show greater strength gains than the same exercises performed later; the evidence for order effects on hypertrophy is weaker and less consistent. Practical rule: put the exercises most important to the current goal first, whether they are compound or isolation.",
  param:"exercise_order", source:"Simão et al. 2012, Sports Medicine 42(3):251-265 (review: 'Exercise order in resistance training')" },
```

**How it relates to the app:**
- The order engine's specialization override (a specialize group with ≥40% of the day's sets goes first) is an application of this "priority first" principle.
- "Compounds before isolation" is the default the engine uses when no group dominates. The review frames that as a convention, not a rule; priority comes first.
- Because the hypertrophy evidence is weaker, the finding text is deliberately hedged. Keep that hedge.

**Verify:**
- [ ] Authors, year, journal, volume and pages.
- [ ] That the paper says earlier placement → more reps, and over time → greater strength.
- [ ] That it describes hypertrophy order effects as less consistent.

---

## P-02 — Energy balance during hypertrophy blocks

Partly overlaps r15 (recomp at a 200–400 kcal deficit) and r17 (deficits over 500 kcal compromise retention). The new information is the size of the effect on lean-mass gain, and the case for a small surplus during a specialization block.

```js
{ id:"r26", tags:["energy_balance"], topic:"energy_balance_hypertrophy", phase:["building","upperFocus","superhero"],
  finding:"Resistance training in an energy deficit still builds strength, but lean-mass gains shrink as the deficit grows; around a ~500 kcal/day deficit, lean-mass gains are largely blunted. For a block whose goal is muscle gain in a specific region, maintenance or a small surplus supports hypertrophy better than a deficit; recomposition at a modest deficit remains realistic for returning or less-trained lifters.",
  param:"calorie_target", source:"Murphy & Koehler 2022, Scand J Med Sci Sports 32(1):125-137 (meta-analysis/meta-regression); Slater et al. 2019, Frontiers in Nutrition (review on energy surplus and hypertrophy)" },
```

**How it relates to the app:**
- It would inform P3-13 (nutrition context). The coach card already clamps calorieDelta to ±300, and P3-13 adds a gate on `calorieDelta > +150` when there's no bodyweight trend.
- It does **not** change any number in `computeNutrition` (target = TDEE − 350 + calorieDelta). A change like that would be a separate decision for Sean.
- It would sit in tension with r15's "recomp at a deficit" framing. Both are true for different situations; the phase tags decide which one the brief shows.

**Verify:**
- [ ] Murphy & Koehler 2022: journal, issue and pages, and that the ~500 kcal/day threshold is what the meta-regression reports.
- [ ] Slater et al. 2019: exact title and that it argues for a modest surplus when maximizing hypertrophy.
- [ ] Whether `energy_balance` should be added to `PRESCRIPTION_RESEARCH_TAGS` (it currently isn't, so this note would only appear in a check-in brief when its phase tags match).
