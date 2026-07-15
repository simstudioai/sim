# Babysit PRs

Owns a PR end-to-end through review: ship it, wait for the automatic review round, and if it
isn't already clean, drive fix → reply → resolve → re-review cycles until Greptile reports 5/5
and there are zero open comment threads. Also keeps the branch mergeable against staging, since
a long babysit session can outlast staging moving underneath it. Designed to be run under
`/loop` (no fixed interval — let it self-pace on review latency) so it survives across multiple
wakeups in the same session.

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

1. **Check current state** before doing anything, including whether the PR is still mergeable:
   ```bash
   gh pr view <n> --json mergeable
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
   If `mergeable` comes back `CONFLICTING`, go fix that first (step 2) before evaluating review
   state — a conflicting PR can't run CI, and this can happen mid-loop even on a PR that was
   clean at creation, since staging moves several times a day. If `mergeable` is `UNKNOWN`
   (GitHub still computing it), don't treat it as either state — but before waiting, check step
   10's two-consecutive-rounds condition first: if it was also `UNKNOWN` on the immediately
   preceding round (recall that from this session, not a fresh query), stop now and surface it
   instead of scheduling another wakeup; otherwise skip the rest of this list and go straight to
   step 9 to wait and recheck next round. Otherwise, if `mergeable` is `MERGEABLE`, Greptile is
   5/5, and every thread across all pages has `isResolved: true`, stop — report the outcome (see
   "Reporting" below) and skip the rest of this list.

2. **If the PR has a merge conflict**, fix it: `git fetch origin staging`, `git merge
   origin/staging`, resolve the conflicts for real (don't just take one side blindly), `git add`
   the resolved files, then `git commit` to complete the merge commit — a merge with conflicts
   stays uncommitted until you do this. If step 1 also found unresolved review threads, don't
   push the conflict fix alone and leave those findings unaddressed — triage and fix them now
   too (step 4), replying/resolving each (step 5), then `git add`/`git commit` those as their
   own commit same as step 7 would (keep it separate from the merge commit). The merge is this
   round's sync check (it already pulls in current `origin/staging`) — no need to also run step
   6's stash/rebase/cherry-pick machinery, which is for a different problem (local stray
   commits) — but do spot-check `git log --oneline --reverse origin/staging..HEAD` still shows
   only commits you recognize before pushing, same as step 6 would. Then run the same pre-push
   checks as step 6 (lint, boundary validation, and the conditional cleanup/db-migrate gates)
   before a plain `git push` — a merge commit doesn't rewrite already-published history, so this
   never needs `--force-with-lease` — and verify the push landed the same way step 7 does. Skip
   step 3 and go straight to step 8 to trigger a fresh review of the resolved code.

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
   either gate just as easily as the original commit did.

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

10. **Stop conditions**: clean state reached (see above), or the same unresolved finding, merge
    conflict, or `UNKNOWN` mergeable result survives two consecutive rounds with no new
    information (surface it to the user instead of looping forever), or the user interrupts.

## Reporting

When the loop ends, summarize: how many rounds it took, what was actually fixed (one line each,
including any merge conflict resolved), what was pushed back on as a false positive and why, and
the final Greptile score / thread count.

## Hard rules

- Never post the two re-review mentions as a single combined comment.
- Never resolve a thread without replying to it first.
- Never fix a finding with a hacky workaround — if the clean fix isn't obvious, find the sibling
  pattern elsewhere in the codebase solving the same class of problem and match it.
- Never silently drop a finding — every thread gets either a code fix or a reasoned reply.
- Always re-run the `/ship`-style sync check before every push in the loop, not just the first.
- Never resolve a merge conflict by blindly taking one side — check the actual diff.
