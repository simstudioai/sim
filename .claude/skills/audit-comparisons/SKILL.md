---
name: audit-comparisons
description: Re-verify every claim on the comparison pages against its own citations, fix what is wrong, refresh the check dates, and report what could not be verified. Runs end to end with no input. Use when comparison data may be stale, before publishing comparison pages, or when asked to fact-check, re-verify, or refresh /comparisons.
---

# Audit comparisons

Re-checks `apps/sim/lib/compare/data/` — 20 competitor profiles plus Sim's own — against the
sources each claim already cites. Wrong or unsupported wording gets corrected, check dates move
to today for sources that were actually read, and anything unreadable is reported instead of
being quietly asserted or quietly dropped.

Run it with no arguments. It needs one thing from the user, once, before any work starts: a
working browser. Everything after that is automatic.

## What this protects

These pages exist to be read by answer engines and LLMs. The long-form text IS the product.
Earlier audits destroyed value by "tidying" — they cut 456 KB of sourced detail, dropped 250
`detail` fields, and reshaped the schema. That is the single worst outcome of a run.

1. **Never shorten `value` or `detail`.** They are long on purpose. `shortValue` (3-10 words) is
   the only short field; it is a compression of `value` that introduces no new claim. If a
   correction makes a claim narrower, the text stays long — it gets *more* precise, not smaller.
   A run that reduces total bytes of `apps/sim/lib/compare/data/competitors/` without a
   correction to justify each cut has failed.
2. **Never change shape.** No new fields, no renamed keys, no new files, no edits outside
   `apps/sim/lib/compare/data/`. The audit updates language and dates in files that already exist.
3. **Absence of evidence is not evidence of absence.** If a capability cannot be confirmed, say
   it is not documented and set `confidence: 'unknown'`. Never write that a product lacks a
   feature because the docs could not be found.
4. **Cite only pages actually read in this run,** and only where the page really contains the
   claim. A 200 response is not support.
5. **Preserve qualifications.** Plan gating, report scope and NDA conditions, preview/beta
   labels, region limits, self-hosted-vs-cloud splits. Losing a qualification is a factual error.
6. **No artifacts.** No reports, notes, manifests or scratch files in the repo. Findings travel
   in agent messages. The tree ends PR-ready.

## Step 0 — Preflight (before spawning anything)

Fail here, loudly, rather than halfway through 21 profiles.

1. `git status --porcelain` in the repo. If `apps/sim/lib/compare/data/` already has uncommitted
   edits, tell the user and stop — the audit needs a clean baseline to diff against.
2. **Static fetch:** WebFetch `https://docs.sim.ai/platform/enterprise/scim`. Expect real prose.
3. **Client-rendered fetch:** WebFetch `https://trust.sim.ai/`. This one is expected to come back
   as a bare title — that is the failure mode the browser exists for, not a problem.
4. **Browser:** navigate to `https://trust.sim.ai/`, wait ~3s for the client render, then read the
   page text. It must list the compliance certifications. If the browser pane is unavailable, the
   navigation is refused, or the text stays empty:

   > Stop. Tell the user the audit needs browser access, name what failed, and ask them to enable
   > it. Do not start the checkers — without the browser fallback every JavaScript-rendered
   > pricing page and trust centre in the set becomes "unverifiable", which is a useless run.

Only when all four pass, continue. Say so in one line and keep going — do not ask permission.

## Step 1 — Units

One unit per profile file: every `apps/sim/lib/compare/data/competitors/*.ts` plus
`apps/sim/lib/compare/data/sim.ts`. A unit is roughly 85 claims and 50-90 URLs, which is the
largest chunk one agent can check without losing precision. Never batch two profiles into one
checker.

`sim.ts` is cited by every competitor page, so audit it too — its claims are load-bearing
everywhere.

## Step 2 — Check (bounded, read-only)

Spawn checkers in batches of 5. Each gets the verbatim prompt in
`agents/checker.md` with `{{PROFILE_PATH}}` replaced. The checker reads one file, opens every
cited URL, and returns two things: a per-URL verdict list, and flags for claims that are wrong,
unsupported, over-stated, or unverifiable. It edits nothing.

## Step 3 — Fix (fresh eyes, flags only)

For each profile that came back with flags, spawn a *fresh* agent with the verbatim prompt in
`agents/fixer.md`. It receives only the file path and that profile's flags plus per-URL verdicts —
no checker reasoning, no conversation history, nothing about the other profiles. It re-opens the
cited page itself, decides whether it agrees, and only then edits.

The split is the point: the checker is free to be suspicious because it cannot change anything,
and the fixer is a genuine second opinion because it never sees the argument, only the claim.
Roughly a quarter of flags are false positives — usually a retrieval that got truncated or a
second attached source that already supported the claim — and the fixer is what catches them.

## Step 4 — Dates

The page's "verified as of" line is derived from the citation dates in the data
(`getLatestVerifiedDate`, and the page review date from the oldest citation), so there is no
separate date to maintain. The fixer sets `asOf` to **today** for every source it or the checker
actually read and confirmed supports its claim, and leaves `asOf` untouched for any source that
came back unverifiable. That way a refreshed date always means "a machine read this page today
and the claim still stood".

## Step 5 — Verify the tree

After every fixer returns:

```bash
cd apps/sim && bun run type-check          # expect 0 errors
cd apps/sim && bunx vitest run "app/(landing)/comparisons" "lib/compare"
bunx biome check $(git diff --name-only | grep -E '\.tsx?$' | tr '\n' ' ')
git status --porcelain                     # MUST contain no '??' lines
git diff --stat                            # MUST touch only lib/compare/data
```

Then compare size: `cat apps/sim/lib/compare/data/competitors/*.ts | wc -c` against the same
command at `git stash`-free HEAD. A large drop means someone truncated long-form text — find it
and restore it before reporting success.

## Step 6 — Report

Print to the conversation only. No files.

- One line per profile: claims checked, URLs read, flags raised, fixes applied, flags rejected.
- **Unverifiable list** — every page that could not be read after both WebFetch and the browser,
  and every cell whose claim now rests on one. This is the most important section; surface it
  even when it is long.
- Anything a fixer disagreed with, with its reason.
- Confirmation that the tree has no new files and no changes outside `lib/compare/data`.

## Known-hard sources

Lessons from previous runs — these are traps, not edge cases:

- **Trust centres and status pages** (`trust.sim.ai` and most vendor equivalents) are client
  rendered. WebFetch returns a bare title. Always browser.
- **Pricing pages with interval toggles** (make.com, pipedream.com) hide the other interval's
  prices behind a control. Read them in the browser and operate the toggle.
- **Plan matrices with tick marks** (Zapier SSO/SCIM) list every plan name in text while the
  ticks restrict the feature to two of them. Text extraction reads the names and loses the
  restriction. Browser, and look at the marks.
- **Docs that carry two generations of guidance** (CrewAI's agent docs kept old Docker examples
  beside an explicit deprecation notice). Prefer the explicit deprecation or "current" section,
  and never "correct" a claim to match a stale example.
- **OpenAI help-centre and product pages** return 403 to automated browsers. Expect
  unverifiable; say so rather than guessing.
- **A flag may be wrong because the fact already cites a second source** that supports it. Check
  every attached source before agreeing with a flag.
