---
name: babysit
description: Drive a PR to a clean review (Greptile 5/5, zero open threads) — ships if needed, triggers Greptile/Cursor Bugbot, fixes real findings, replies to and resolves every thread, and loops until clean
---

# Babysit PRs

Owns a PR end-to-end through review: ship it, wait for the automatic review round, and if it
isn't already clean, drive fix → reply → resolve → re-review cycles until Greptile reports 5/5
and there are zero open comment threads. Designed to be run under `/loop` (no fixed interval —
let it self-pace on review latency) so it survives across multiple wakeups in the same session.

## When to use

- The user says "babysit this PR", "keep working the reviews until it's clean", or similar
- As the natural follow-up to `/ship` when the user wants the review loop automated rather than
  manually re-triggering reviews and answering comments themselves

## Inputs

Needs a PR number. If none is given and there's no open PR for the current branch, run `/ship`
first (which includes the `origin/staging` sync check — see `.agents/skills/ship/SKILL.md`) to
create one.

## Definition of "clean"

Both must hold:
1. The latest Greptile summary comment reports **Confidence Score: 5/5**
2. `reviewThreads` (GraphQL, see below) has **zero threads with `isResolved: false`**

Do not stop early on "no new comments this round" alone — a thread can be open from an earlier
round. Always check both conditions freshly after every push.

## Loop

1. **Check current state** before doing anything:
   ```bash
   gh pr view <n> --json comments -q '.comments[] | select(.author.login=="greptile-apps") | .body' | tail -1
   gh api graphql -f query='
   query { repository(owner: "<owner>", name: "<repo>") { pullRequest(number: <n>) {
     reviewThreads(first: 50) { nodes { id isResolved path line
       comments(first: 5) { nodes { id databaseId author { login } body } } } } } } }'
   ```
   If Greptile is 5/5 and every thread's `isResolved` is `true`, stop — report the outcome (see
   "Reporting" below) and skip the rest of this list.

2. **If no review has run yet** (fresh PR, no Greptile/Cursor comments): they usually run
   automatically on PR open — confirm via `gh pr checks <n>` (look for `Cursor Bugbot` /
   `Greptile Review`) and wait for that first round before doing anything else.

3. **If a review round has landed and it isn't clean**: for every thread where
   `isResolved: false`, triage the finding on its own merits — this is the part that requires
   judgment, not a mechanical loop:
   - **Real bug**: fix it in the cleanest way available. Match the codebase's existing
     conventions for that kind of problem before inventing a new one (e.g. an SSRF-prone
     user-supplied-host fetch should use whatever `validateUrlWithDNS`/`secureFetchWithPinnedIP`
     pattern the rest of the codebase already uses for that exact situation — grep for a sibling
     integration solving the same problem first). Never patch around a finding with a
     workaround, a broad try/catch, or a suppression comment — fix the actual cause.
   - **False positive**: don't change code. Reply with the specific reason it doesn't apply
     (cite the type definition, the established pattern it matches, or the doc it follows) so
     the reviewer bot and a human skimming later both understand why it was left as-is.
   - **Already fixed by an earlier finding in the same round**: note that and resolve without a
     duplicate code change.

4. **Reply to every thread individually** before resolving it — never resolve silently:
   ```bash
   gh api repos/<owner>/<repo>/pulls/<n>/comments/<databaseId>/replies -f body="<what was done and why>"
   ```
   Then resolve via GraphQL (needs the thread `id` from step 1, not the comment id):
   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<threadId>"}) { thread { isResolved } } }'
   ```

5. **Before pushing, re-run the sync check** from `/ship` step 2
   (`git fetch origin staging && git log --oneline origin/staging..HEAD` should list only this
   session's commits) — a babysit loop that runs over a long session is exactly the scenario
   where a branch can drift. Then run the repo's lint/typecheck/boundary-validation gates the
   same way `/ship` does before committing.

6. **Commit and push** the round's fixes as one commit (`--force-with-lease` only if step 5's
   sync check required a rebuild).

7. **Re-trigger review** by posting `@greptile` and `@cursor review` as **two separate PR
   comments** — never combine them into one comment, each bot only responds to its own mention:
   ```bash
   gh pr comment <n> --body "@greptile"
   gh pr comment <n> --body "@cursor review"
   ```

8. **Wait for the new round**, then go back to step 1. Pace the wait with `ScheduleWakeup` using
   a fallback delay of ~250–300s (Greptile/Cursor typically take 1–3 minutes) — never busy-poll
   in a sleep loop. Pass the same `/loop babysit PR <n>` prompt on each wakeup so the loop
   resumes correctly.

9. **Stop conditions**: clean state reached (see above), or the same unresolved finding survives
   two consecutive rounds with no new information (surface it to the user instead of looping
   forever), or the user interrupts.

## Reporting

When the loop ends, summarize: how many rounds it took, what was actually fixed (one line each),
what was pushed back on as a false positive and why, and the final Greptile score / thread count.

## Hard rules

- Never post the two re-review mentions as a single combined comment.
- Never resolve a thread without replying to it first.
- Never fix a finding with a hacky workaround — if the clean fix isn't obvious, find the sibling
  pattern elsewhere in the codebase solving the same class of problem and match it.
- Never silently drop a finding — every thread gets either a code fix or a reasoned reply.
- Always re-run the `/ship`-style sync check before every push in the loop, not just the first.
