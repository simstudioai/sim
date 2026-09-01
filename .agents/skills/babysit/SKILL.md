---
name: babysit
description: Drive a PR to a clean review (Greptile 5/5, zero open threads) — ships if needed, keeps it mergeable against staging, re-triggers both Greptile and cubic, fixes real findings, replies to and resolves every thread, and loops until clean
---

# Babysit PRs

Owns a PR end-to-end through review: ship it, wait for the automatic review round, and if it
isn't already clean, drive fix → reply → resolve → re-review cycles until Greptile reports 5/5
and there are zero open comment threads, keeping the branch mergeable against staging along the
way. Two bots review this repo — Greptile and cubic — and they behave differently; see
"Two reviewers" below. Designed to be run under `/loop` (no fixed interval — let it self-pace on review latency)
so it survives across multiple wakeups in the same session.

## When to use

- The user says "babysit this PR", "keep working the reviews until it's clean", or similar
- As the natural follow-up to `/ship` when the user wants the review loop automated rather than
  manually re-triggering reviews and answering comments themselves

## Inputs

Needs a PR number. If none is given and there's no open PR for the current branch, run `/ship`
first (which includes the `origin/staging` sync check — see `.agents/skills/ship/SKILL.md`) to
create one.

## Two reviewers

Both post inline threads that count toward "clean", and they need re-triggering separately:

| | Greptile (`greptile-apps`) | cubic (`cubic-dev-ai`) |
|---|---|---|
| Verdict | `Confidence Score: X/5` in a summary comment | no score — only inline threads |
| Summary comment | edited in place across rounds | fresh review per run |
| Re-trigger | `@greptile` | `@cubic-dev-ai review this PR` |
| Latency | 1–3 min | 1–3 min |

Post **both** after every push, as two separate comments. Triggering only Greptile is the easy
mistake: the PR then shows 5/5 with cubic's threads still open from an earlier commit, and its
findings never get re-checked against the fix.

`@cubic-dev-ai review this PR` is the documented wording — `@cubic` alone does not trigger it.

cubic reviews the commit that was HEAD when its run started, so a thread can describe code the
next commit already changed. Before treating a cubic finding as real, check whether the current
HEAD still has the problem — a stale round is a reply-and-resolve, not a fix.

## Definition of "clean"

All three must hold:
1. The latest Greptile summary comment reports **Confidence Score: 5/5**
2. `reviewThreads` (GraphQL, see below) has **zero threads with `isResolved: false`**, from
   either bot
3. Every check has **finished and passed** — `gh pr checks <n>` shows no `fail` *and* no
   `pending`. A red run is not clean no matter what the reviewers say, and the lint/audit jobs
   routinely catch what a local run misses. A `pending` one is not clean either: it has not
   reported yet, and treating "not failing" as "passing" reports the PR clean before CI has
   had its say. Wait for it — the step-10 stop condition covers a check that never settles.

Do not stop early on "no new comments this round" alone — a thread can be open from an earlier
round, and cubic often lands its first threads a round after Greptile's. Always check all three
conditions freshly after every push.

## Loop

1. **Check current state** before doing anything, including whether the PR is still mergeable:
   ```bash
   gh pr view <n> --json mergeable
   gh pr checks <n> | grep -v skipping
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
   The query returns both bots' threads. A `ReviewThread` has no author of its own — identity
   lives on its comments, so read the opener's at `comments.nodes[0].author.login` and do not
   add an `author` field at the thread level, which makes the query fail to compile.
   If `mergeable` is `CONFLICTING`, fix that first (step 2). If a check is failing, fix that too
   — treat it exactly like a review finding. If a check is still `pending`, do not evaluate
   "clean" at all: go to step 9 and wait for it. Otherwise, if Greptile is 5/5, every thread
   across all pages has `isResolved: true`, and every check has finished and passed, stop —
   report the outcome (see "Reporting" below) and skip the rest of this list.

2. **If the PR has a merge conflict**, merge `origin/staging`, resolve the conflicts, run the
   usual pre-push checks, push, and go to step 8 to re-trigger review.

3. **If no review has run yet** (fresh PR, no bot comments): both run automatically on PR open —
   confirm via `gh pr checks <n>` (look for `Greptile Review` and `cubic · AI code reviewer`) and
   wait for both before doing anything else. They finish at different times, so a PR that looks
   clean because only one has reported is not clean yet.

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

8. **Re-trigger both reviewers**, each as its own PR comment — a combined comment does not
   reliably trigger both:
   ```bash
   gh pr comment <n> --body "@greptile"
   gh pr comment <n> --body "@cubic-dev-ai review this PR"
   ```
   Then confirm both actually picked it up before waiting — `gh pr checks <n>` should show
   `Greptile Review` and `cubic · AI code reviewer` as `pending`. If one stayed `pass` from the
   previous round, its trigger did not land; re-post that one.

9. **Wait for the new round**, then go back to step 1. Pace the wait with `ScheduleWakeup` using
   a fallback delay of ~300s — both bots take 1–3 minutes, and CI is usually the slowest of the
   three — never busy-poll in a sleep loop. Pass the same `/loop babysit PR <n>` prompt on each wakeup so the loop
   resumes correctly.

10. **Stop conditions**: clean state reached (see above), or the same unresolved finding or
    merge conflict survives two consecutive rounds with no new information (surface it to the
    user instead of looping forever), or the user interrupts.

## Reporting

When the loop ends, summarize: how many rounds it took, what was actually fixed (one line each),
what was pushed back on as a false positive and why, and the final state — Greptile score, open
thread count across both bots, and whether every check finished and passed.

## Public-repo hygiene

Every reply, comment and commit you post here is public and permanent, and review bots quote
your replies back so a leak propagates. Before each post, strip anything that ties the change to
a tenant: customer/company names, workspace/user/org/KB/connector IDs, emails, tenant hostnames,
verbatim document/sheet/folder names, log lines, and per-tenant DB output. Cite the mechanism and
aggregate numbers instead — see `/ship`'s "What to Omit" for the full list and the pre-publish
grep. Triaging a finding often means pasting evidence you gathered from prod; that is exactly the
moment this gets violated. Check before posting, not after: editing a comment does not unsend its
notification email.

## Hard rules

- Never paste prod evidence into a reply without scrubbing it first (see above).
- Never resolve a thread without replying to it first.
- Never fix a finding with a hacky workaround — if the clean fix isn't obvious, find the sibling
  pattern elsewhere in the codebase solving the same class of problem and match it.
- Never silently drop a finding — every thread gets either a code fix or a reasoned reply.
- Never re-trigger only one reviewer. Both get a comment after every push, and both get confirmed
  `pending` before you start waiting.
- Always re-run the `/ship`-style sync check before every push in the loop, not just the first.
