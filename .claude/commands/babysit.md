---
description: Drive a PR to a clean review (Greptile 5/5, zero open threads) — ships if needed, keeps it mergeable against staging, triggers Greptile/Cursor Bugbot, fixes real findings, replies to and resolves every thread, and loops until clean
---

# Babysit PRs

Owns a PR end-to-end through review: ship it, wait for the automatic review round, and if it
isn't already clean, drive fix → reply → resolve → re-review cycles until Greptile reports 5/5
and there are zero open comment threads. Also keeps the branch mergeable against staging — a
long-running loop spans hours during which staging can drift out from under the PR and produce
a real merge conflict, not just the stray-local-commit drift `/ship`'s sync check catches.
Designed to be run under `/loop` (no fixed interval — let it self-pace on review latency) so it
survives across multiple wakeups in the same session.

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

1. **Check current state** before doing anything — this includes mergeable state, not just
   review state:
   ```bash
   gh pr view <n> --json mergeable,mergeStateStatus
   gh pr view <n> --json comments -q '[.comments[] | select(.author.login=="greptile-apps")] | last | .body'
   gh api graphql -f query='
   query { repository(owner: "<owner>", name: "<repo>") { pullRequest(number: <n>) {
     reviewThreads(first: 50) { pageInfo { hasNextPage endCursor } nodes { id isResolved path line
       comments(first: 5) { nodes { id databaseId author { login } body } } } } } } }'
   ```
   `[.comments[]] | last | .body`, not `... | .body | tail -1` — the latter pipes every matching
   comment's full multi-line body through the pipeline and keeps only the final *line* of that
   combined output (usually the "Reviews (n): Last reviewed commit..." footer), not the last
   *comment*, so it silently misses the actual "Confidence Score: X/5" line.
   `reviewThreads(first: 50)` is a single page — check `pageInfo.hasNextPage`. If `true`, don't
   stop yet: re-run the same query with `after: "<endCursor>"` and keep paging until
   `hasNextPage` is `false` before evaluating "clean." A PR with more than 50 threads is rare but
   stopping on a partial page would silently miss unresolved ones past the cutoff.
   `mergeable` is `UNKNOWN` for a few seconds right after any push or base-branch move while
   GitHub computes it — re-poll `gh pr view <n> --json mergeable` every few seconds until it
   settles to `MERGEABLE` or `CONFLICTING` before acting on it; don't treat `UNKNOWN` as either.
   If `mergeable` is `CONFLICTING`, skip straight to step 2 (Resolve merge conflicts) — do not
   evaluate review cleanliness yet, since Greptile/Cursor threads anchored to a conflicting diff
   can be stale and CI can't even run to confirm anything.
   If `mergeable` is `MERGEABLE`, Greptile is 5/5, and every thread across all pages has
   `isResolved: true`, stop — report the outcome (see "Reporting" below) and skip the rest of
   this list.

2. **If `mergeable` is `CONFLICTING`**, resolve it before anything else this round. This can
   happen even on a PR that was clean at creation, since staging moves several times a day —
   recheck every iteration, don't assume it's a one-time state handled by `/ship`.
   ```bash
   git status                      # stash -u first (ship-sync-fix pattern) if anything uncommitted
   git fetch origin staging
   git rebase origin/staging
   ```
   Resolve each conflicted file on its actual merits — open it, read both sides inside the
   `<<<<<<<` / `=======` / `>>>>>>>` markers, and keep the intent of *both* changes where they're
   not truly contradictory. Never resolve with a blanket `git checkout --ours`/`--theirs` across
   a whole file — that silently discards one side's real change instead of merging it. `git add`
   each resolved file, then `git rebase --continue`; repeat until the rebase finishes clean (a
   rebase with **zero remaining conflicts** does not by itself mean the resolution is correct —
   see the next point).
   - A conflict resolution is a code change like any other: before pushing, run this repo's
     typecheck/lint pass on the touched files (the same checks `/ship` step 6 runs) — merge
     markers can resolve syntactically clean and still be semantically wrong or fail to compile.
   - Push with `git push --force-with-lease` — a rebase here always rewrites already-published
     history, so a plain `git push` will be rejected.
   - Re-poll `gh pr view <n> --json mergeable,mergeStateStatus` until it reports `MERGEABLE`
     (not `UNKNOWN`) before moving on. If it still reports `CONFLICTING`, the rebase resolved
     against a stale local `origin/staging` — `git fetch origin staging` again and redo the
     rebase; don't push a second time believing it's fixed without this recheck.
   - This push needs a fresh review like any other code change — go to step 8 (re-trigger
     review) rather than trying to also address old review threads in the same pass, especially
     if the conflict touched files a thread was anchored to (that anchor may no longer be valid
     against the resolved code). Re-evaluate thread state fresh once the new round lands.

3. **If no review has run yet** (fresh PR, no Greptile/Cursor comments): they usually run
   automatically on PR open — confirm via `gh pr checks <n>` (look for `Cursor Bugbot` /
   `Greptile Review`) and wait for that first round before doing anything else.

4. **If a review round has landed and it isn't clean**: for every thread where
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

5. **Reply to every thread individually** before resolving it — never resolve silently:
   ```bash
   gh api repos/<owner>/<repo>/pulls/<n>/comments/<databaseId>/replies -f body="<what was done and why>"
   ```
   Then resolve via GraphQL (needs the thread `id` from step 1, not the comment id):
   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<threadId>"}) { thread { isResolved } } }'
   ```

6. **Before pushing, re-run the full sync check from `/ship` step 2** — not just the log command,
   the whole check-and-recover flow (stash WIP if needed, rebase, verify the rebase didn't just
   cleanly replay stray commits, cherry-pick rebuild if it did or if it conflicted). A babysit
   loop spanning a long session is exactly the scenario where a branch can drift, and pushing
   review fixes on top of undetected drift is how an oversized PR happens even after the branch
   was fixed once. Then run the repo's pre-ship checks the same way `/ship` does before
   committing — not just lint/typecheck/boundary-validation, but also the conditional `/cleanup`
   (if this round's fix touched UI code) and `/db-migrate` (if it touched schema/migrations)
   gates from `/ship` steps 4 and 5. A review-fix round is still a code change and can trip
   either gate just as easily as the original commit did. This is the same sync check as step 2
   above but for local-drift, not for the base-branch textual conflicts step 2 handles — step 2
   already left the branch rebased onto current `origin/staging` when it ran, so this step is
   normally a no-op in that case, but still run it: it also catches stray local commits that
   have nothing to do with merge conflicts.

7. **Commit and push** the round's fixes as one commit — `--force-with-lease` whenever step 6's
   sync check rewrote history, which includes a plain `git rebase origin/staging` that completed
   with no conflicts, not only the cherry-pick rebuild path; both rewrite commits already
   published to the remote, so a plain `git push` can be rejected either way — then run `/ship`
   step 9's post-push verify — not just before the first push, every push in the loop:
   ```bash
   git fetch origin staging && git log --oneline --reverse origin/staging..HEAD
   gh pr view <n> --json commits -q '.commits[].messageHeadline'
   ```
   `--reverse` makes `git log` oldest-first, matching the PR commit list's order — plain
   `git log` is newest-first, so without it a positional comparison can spuriously fail on any
   multi-commit branch.
   These two lists must describe the same commits. A review loop runs many pushes across many
   rounds; checking sync only before the push (step 6) and never after is how a bad push or a
   PR whose commit history quietly went stale between rounds goes unnoticed.

8. **Re-trigger review** by posting `@greptile` and `@cursor review` as **two separate PR
   comments** — never combine them into one comment, each bot only responds to its own mention:
   ```bash
   gh pr comment <n> --body "@greptile"
   gh pr comment <n> --body "@cursor review"
   ```

9. **Wait for the new round**, then go back to step 1. Pace the wait with `ScheduleWakeup` using
   a fallback delay of ~250–300s (Greptile/Cursor typically take 1–3 minutes) — never busy-poll
   in a sleep loop. Pass the same `/loop babysit PR <n>` prompt on each wakeup so the loop
   resumes correctly.

10. **Stop conditions**: clean state reached (see above), or the same unresolved finding
    survives two consecutive rounds with no new information, or the same merge conflict recurs
    every round with no new information (e.g. a semantic conflict you can't confidently resolve
    without changing intent), or the user interrupts — surface any of these to the user instead
    of looping forever.

## Reporting

When the loop ends, summarize: how many rounds it took, what was actually fixed (one line each),
what was pushed back on as a false positive and why, how many merge conflicts came up and against
which staging commits (if any), and the final Greptile score / thread count / mergeable state.

## Hard rules

- Never post the two re-review mentions as a single combined comment.
- Never resolve a thread without replying to it first.
- Never fix a finding with a hacky workaround — if the clean fix isn't obvious, find the sibling
  pattern elsewhere in the codebase solving the same class of problem and match it.
- Never silently drop a finding — every thread gets either a code fix or a reasoned reply.
- Always re-run the `/ship`-style sync check before every push in the loop, not just the first.
- Never resolve a merge conflict with a blanket `--ours`/`--theirs` across a whole file — read
  both sides and preserve the real intent of each; a wrong resolution ships silently since
  nothing else catches it.
- Never treat `mergeable: UNKNOWN` as either `MERGEABLE` or `CONFLICTING` — poll until it settles.
- Never evaluate review-thread cleanliness while `mergeable` is `CONFLICTING` — resolve the
  conflict first, since threads anchored to a conflicting diff can be stale.
