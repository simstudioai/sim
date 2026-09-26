---
name: ship
description: Commit, check design conformance, push, and open a PR to staging — runs cleanup and the applicable migration safety review first
argument-hint: "[optional context or scope notes]"
---

# Ship Command

You help ship code by creating commits, pushing to the remote branch, and creating PRs in the user's voice.

## Your Task

When the user runs `/ship`:

1. **Check git status** - See what files have changed
2. **Sync check**: `git fetch origin staging && git log --oneline origin/staging..HEAD`. The list must contain ONLY commits you can attribute to this session (recognizable subjects/SHAs) — a worktree/branch cut from a stale local `staging` silently drags in unrelated commits.
   - If it shows commits you don't recognize, fix it now, **before** staging/committing any new work (step 7 hasn't run yet):
     - If the working tree has uncommitted changes, stash them first so the rebase below isn't blocked by dirty state, and pin the entry by SHA — the stash list is shared across every worktree of the repo, so `stash@{0}` and `git stash pop` can grab another session's entry:
       ```bash
       git stash push -u -m ship-sync-fix && SHIP_STASH=$(git rev-parse 'stash@{0}')
       # once the branch is fixed (`git stash drop` rejects a raw SHA, so resolve the pinned
       # entry's current stash@{n} and drop only that; an empty lookup drops nothing):
       git stash apply "$SHIP_STASH" &&
         SHIP_STASH_REF=$(git stash list --format='%gd %H' | awk -v s="$SHIP_STASH" '$2==s{print $1}') &&
         { [ -z "$SHIP_STASH_REF" ] || git stash drop "$SHIP_STASH_REF"; }
       ```
     - Try `git rebase origin/staging` first.
     - **A rebase finishing without conflicts does NOT by itself mean the branch is clean** — it can replay stray commits onto the new base with no conflict at all. After the rebase (clean or not), re-run `git log --oneline origin/staging..HEAD` and re-check the commit list against what you recognize.
     - If the rebase conflicted on unrecognized commits, OR finished cleanly but the log still shows them, abandon it (`git rebase --abort` if mid-rebase) and rebuild, in this exact order:
       1. Still on `<original-branch>`, list `git log --oneline --reverse origin/staging..<original-branch>` and write down ONLY the SHA(s) that are this session's work — the range also contains the stray commits, so cherry-picking the whole range recreates the polluted branch. Capture them now; after step 4 they are no longer in `HEAD`.
       2. `git checkout <original-branch>` (required if an interrupted attempt left you on `ship-sync-tmp`)
       3. `git branch -D ship-sync-tmp 2>/dev/null || true`
       4. `git checkout -b ship-sync-tmp origin/staging`
       5. `git cherry-pick` the captured SHAs, oldest-first. Resolve conflicts.
       6. `git branch -f <original-branch> HEAD && git checkout <original-branch> && git branch -D ship-sync-tmp`
   - Re-verify with `git log --oneline origin/staging..HEAD` — it must list only commits you recognize before you proceed to committing new work.
3. **Generate a commit message** following this format: `type(scope): description`
  - Types: `fix`, `feat`, `improvement`, `chore`
  - Scope: short identifier (e.g., `undo-redo`, `api`, `ui`)
  - Keep it concise
4. **Run the cleanup and test gates**
  - If the diff modifies UI code (any non-test `.tsx` file, or anything under `apps/sim/components/`, `apps/sim/hooks/`, or `apps/sim/stores/`), run `/cleanup`. It fans out the React/UI passes (effects, memo, callbacks, state, React Query, emcn, url-state), the comment pass, and the test-audit pass, and applies fixes so they land in this commit.
  - Otherwise, if the diff adds or changes tests (`*.test.ts(x)`, `*.integration.ts`, `**/e2e/**`, `apps/sim/scripts/test-*-e2e.ts`), run `/test-audit audit <changed test files>` on its own. Every new or changed test must pass the authoring gate; delete the ones that don't rather than shipping them.
  - Then run the test files the diff adds or changes, plus the existing tests beside changed source files, with `bun run --cwd <workspace> test <paths>` (`bun run --cwd apps/sim test <paths>` for the app; `*.integration.ts` needs the setup in `.claude/rules/sim-testing.md`). A failing test aborts ship.
5. **Run migration safety** — only if the diff touches `packages/db/migrations/**` or `packages/db/schema.ts`:
  - Run `/db-migrate` to review the migration for zero-downtime safety (expand/contract phasing, backward-compatibility with the deployed app version).
  - `bun run check:migrations origin/staging` must pass (staging is the PR base). Do not silence a flagged statement with a `-- migration-safe:` annotation unless `/db-migrate` confirmed the old code no longer depends on it; otherwise split the destructive change into a later deploy.
6. **Run pre-ship checks** from the repo root before staging. This has two phases: first **regenerate** every committed artifact so generated files never drift into a CI failure (this is what catches things like `agent-stream-docs` going stale after a `models.ts` edit), then run the **full audit suite** CI's `Lint and Test` job enforces. Both phases parallelize — but only across commands that write **disjoint** outputs — and a bare `wait` swallows child exit codes, so both phases below explicitly collect each job's status and abort ship if any failed.

  **Phase A — regenerate the always-in-repo committed artifacts (parallel), then let step 7 stage whatever changed.** Regenerate only the generators whose inputs live entirely in this repo and that any ordinary code change can drift — `agent-stream-docs:generate` (derives from the provider model registry), `docs-manifest:generate` (derives from docs page paths), and `skills:sync` (derives from `.agents/skills/**`). They write disjoint outputs (`apps/docs/…/agent.mdx`, `apps/sim/lib/copilot/generated/docs-manifest.ts`, and `.claude/skills` links), so they parallelize safely, and each is idempotent (a no-op when already in sync):
  ```bash
  rm -f /tmp/ship-gen-results
  for g in agent-stream-docs:generate docs-manifest:generate skills:sync; do
    ( bun run "$g" >"/tmp/ship-gen-${g//:/-}.log" 2>&1; echo "$? $g" >>/tmp/ship-gen-results ) &
  done
  wait
  # any non-zero line is a FAILED generator — read /tmp/ship-gen-<name>.log and fix before shipping;
  # a silently-failed generate leaves a stale artifact that Phase B / CI then rejects. Keep the
  # `exit 1`: it is what makes the block's own status non-zero so a caller actually stops.
  if grep -vE '^0 ' /tmp/ship-gen-results; then echo "❌ generator(s) failed — do not ship"; exit 1; fi
  echo "✅ artifacts regenerated"
  ```
  Then `git status --short` to see what regenerated — those files must be staged in step 7 alongside your own changes.

  **Do NOT blanket-run the domain generators here.** `mship:generate` (`generate-mship-contracts.ts`) is an **umbrella** that drives all nine mothership contract generators (`mship-contracts`, `billing-protocol-contract`, `mship-tools`, the four `trace-*`, `metrics-contract`, `vfs-snapshot-contract`) and biome-formats `apps/sim/lib/copilot/generated/` — never run it *and* its constituents (they write the same files and corrupt each other in parallel), and never run it on an ordinary ship: it reads an **external** copilot-contract source that isn't checked out in most worktrees, so it hard-fails with `ENOENT` and would abort ship for an unrelated reason. `generate:pi-model-catalog` (under `apps/sim`) likewise regenerates from the installed Pi package, not repo source. `scripts/generate-docs.ts` rewrites the integration docs and client-safe catalog; run it when this PR changes their block/icon/landing-content inputs or when `integration-catalog:check` reports drift, then review its broad generated diff. Only when **this PR's diff actually touches** a domain generator's input do you regenerate it deliberately and run its matching `:check` (`bun run mship:check` / the individual `*:check`) — with the external source present.

  **Phase B — run lint + every audit CI enforces, in parallel, and abort ship if any fails.** Before running the commands, compare this list with `.github/workflows/test-build.yml`; when CI adds an audit, run it and update this skill instead of trusting a stale snapshot. The env-flag audit is currently an inline workflow block rather than a package script: when `apps/sim/lib/core/config/env-flags.ts` changed, run that current workflow block verbatim instead of copying a second version into this skill. Run `bun run lint` first (it autofixes formatting and mutates files, so don't parallelize it with the read-only audits), then run the base-sensitive block-registry check, then fan the independent audits out and collect exit codes:
  ```bash
  # autofix formatting first (mutating; not parallel-safe with the audits). Gate its exit too —
  # a non-zero lint (unfixable errors) must abort before the audits run, not be ignored.
  bun run lint || { echo "❌ lint failed — do not ship"; exit 1; }
  bun run apps/sim/scripts/check-block-registry.ts origin/staging || {
    echo "❌ block registry audit failed — do not ship"
    exit 1
  }
  # Runs every audit CI runs, concurrently, and replays the output of any that fail.
  # The audit list is derived in scripts/run-audits.ts — do not hand-list audits here.
  bun run check:audits || { echo "❌ audit(s) failed — do not ship"; exit 1; }
  # CI's "Verify docs manifest is in sync" step is not a `check:*` script, so the runner above
  # does not cover it. (CI's "Security audit" `bun audit` step is `continue-on-error` — advisory
  # only, not a gate — so it is deliberately not run here.)
  bun run docs-manifest:check || { echo "❌ docs manifest out of sync — do not ship"; exit 1; }
  ```
  If Phase A regenerated a file, its matching `:check` in Phase B now passes trivially — that parity is the point. Do not ship with any generator or audit failing; fix the cause (never silence it) and re-run. `check:migrations` and `type-check` are covered by steps 5 and CI respectively and are not repeated here.
7. **Stage and commit** the changes with the generated message — including any files Phase A regenerated in step 6. Then run the [committed design check](#committed-design-check) below and resolve or explain its findings before step 8.
8. **Push to origin** using the current branch name — `--force-with-lease` if step 2's sync
   check did any history rewrite (a clean rebase or a cherry-pick rebuild) on a branch that had
   already been pushed once; a plain push would be rejected in exactly the polluted-remote case
   step 2 exists to fix
9. **Create a PR** to staging with a description in the user's voice, then do a final content check — not a count check — comparing what actually landed:
   ```bash
   git fetch origin staging && git log --oneline --reverse origin/staging..HEAD
   gh pr view <n> --json commits -q '.commits[].messageHeadline'
   ```
   Re-fetch first — comparing against a stale local `origin/staging` ref can mask real drift or
   flag a false mismatch even when the branch and push are correct. `--reverse` makes the git log
   oldest-first, matching the PR commit list's order — plain `git log` is newest-first, and a
   positional/line-by-line comparison against the PR's oldest-first list can spuriously fail on
   any multi-commit branch. These two lists must describe the same commits in the same order
   (same subjects, the last one being the commit from step 7). If they don't match, the branch
   still has a problem — redo step 2's fix, repeat the committed design check for the resulting HEAD, and `git push --force-with-lease`.

## Committed design check

When central EMCN sources, global styles, recipes or `@designAllow`/`@designProtect` metadata change, run `bun run design:generate`, review the result and commit `contracts.generated.json` alongside the source. `check:design-generated` is part of `check:audits`; stale output is an infrastructure error. Regeneration does not suppress the source finding.

During product UI work, run `bun run check:design --base origin/staging --working-tree` so staged, unstaged and nonignored new files are included. Review findings against EMCN and `globals.css`; explain intentional new Extras rather than weakening the checker. After committing and before **every push**, run this from the repository root with Bun 1.4.1:

```bash
bun run check:design --base origin/staging --head HEAD
```

Run it for every `/ship`; let the checker apply its own scope. A `.tsx`-only condition would miss CSS, Tailwind configuration, artwork and contract-registry changes. `check:audits` deliberately excludes this base-dependent command. It reads committed merge-base → HEAD blobs, so a run before committing cannot validate the pending changes.

Interpret both the exit status and the report:

- **0 with a completed report:** no findings; continue to push.
- **1 with a completed report:** read the usage violations and central-system notifications. Triage them before pushing; findings are warnings, not an automatic shipping failure.
- **2, unexpected termination, or no completed report:** the check did not complete. Fix the operational problem and rerun before pushing. A startup failure with exit 1 is not a findings report. Do not hide failures with `|| true` or treat missing output as a pass.

Fix straightforward usage violations through the cited central component, prop, recipe or token. For a small local gray correction, choose the approved token appropriate to its role. Do not invent a new token or loosen a contract just to remove the warning. Keep fixes within the work being shipped; unchanged debt elsewhere can wait for its own cleanup.

When a change has broad shared impact or ambiguous intent, explain the finding and ask the engineer how to proceed. Intentional central-system changes and justified exceptions can proceed with an explanation in the PR; involve the designer for new standards or ambiguous broad changes. Honor decisions already given in this session. Retain the warning rather than weakening the linter or requiring every intended system change to produce a clean report.

If this review produces edits, rerun the affected generation/lint/audit checks from step 6, commit the fixes, then repeat the design check against the new HEAD. Also rerun after a rebase, conflict resolution or other change to the comparison. Push only the checked commit; uncommitted fixes are not covered by an earlier result.

In the PR's **Testing** section, record the design-check outcome and explain any retained warnings. Leave **No new warnings introduced** unchecked when warnings remain. This review is about central design-system conformance; approved component variants, colours and fonts remain available for the engineer's product decisions. See `scripts/design-conformance/README.md` for scope and known unchecked inputs.

## Commit Message Format

Based on the repo's commit history:

```
fix(scope): description for bug fixes
feat(scope): description for new features
improvement(scope): description for enhancements
chore(scope): description for maintenance
```

## What to Omit

The repo is public. **Everything you publish — title, description, commit messages, and every later comment — must stand on its own without the incident that produced it.** Never include:

- Customer, company, or user names; workspace/user/org/KB/connector IDs; email addresses
- Prod or staging operational data: log lines, DB rows, metrics, timestamps, incident details, canary/alert output
- Infrastructure specifics: hostnames (incl. tenant subdomains), ARNs, internal URLs, env var values, secret names
- Verbatim customer content: file names, document titles, sheet/column names, folder paths

Describe the bug by its mechanism, not by how you found it. "Expired OAuth credentials fail to refresh in the worker" — not "the Sheets canary failed at 16:31Z for workspace abc-123". Aggregate counts are fine once detached from the tenant ("1,379 PDFs failed"); the same number attributed to a named customer is not. Replace real examples with placeholders (`<real sheet name>`) rather than cutting them — the illustration is usually the useful part.

**Measurements are not the problem; absolute production scale is.** Keep the numbers that justify a change — durations, ratios, before/after timings, test and audit counts. They are the evidence a reviewer needs, and stripping them makes the rationale unfalsifiable. What does not belong is anything that sizes production or a tenant: table and index byte sizes, row/chunk/document totals, dead-tuple counts, buffer and heap-fetch counts, worker or instance counts. "Visiting four times as many tuples took 5.1s and 9.7s on consecutive runs" is fine; "on a 132k-chunk index" or "reclaims ~19 GB" is not. The same rule applies to code comments and migration comments, which are published exactly like a PR body — this is the most commonly missed case, because they do not feel like publishing.

**Scrub before publishing, not after** — a leak is public the instant it posts, and editing later does not unsend the notification email. This applies to every PR you open, including ones created directly with `gh pr create` rather than through this skill. Grep the title, body, `git log origin/staging..HEAD`, AND the diff itself before publishing:

```bash
# identities, IDs, infrastructure
grep -niE 'customer-or-company-name|@[a-z0-9.-]+\.(com|io|ai)|[0-9a-f]{8}-[0-9a-f]{4}-|\.sharepoint\.com|arn:aws|https?://[a-z0-9.-]*\.internal'
# absolute production scale — byte sizes, k/M-scale entity counts, 7-figure totals
grep -niE '[0-9][0-9.,]* ?(TB|GB)\b|[0-9]+(\.[0-9]+)?[kKmM][- ](row|chunk|document|vector|tuple|doc)|[0-9]{1,3}(,[0-9]{3}){2,}'
```

The second pattern deliberately allows ordinary engineering numbers (`5.1s`, `46 audits`, `2,921 tests`) and flags only production sizing.

## PR Description Format

Use this exact template in the user's voice (concise, bullet points):

```markdown
## Summary
- bullet point describing what changed
- another bullet point if needed

## Type of Change
- [x] Bug fix (or appropriate type)

## Testing
Describe the checks, tests, and E2E artifacts run

## Checklist
- [x] Code follows project style guidelines
- [x] Self-reviewed my changes
- [ ] Tests added/updated and passing (new tests pass the `test-audit` authoring gate)
- [ ] No new warnings introduced
- [x] I confirm that I have read and agree to the terms outlined in the [Contributor License Agreement (CLA)](./CONTRIBUTING.md#contributor-license-agreement-cla)
```

## PR Creation Command

Use this command structure:

```bash
gh pr create --base staging --title "COMMIT_MESSAGE" --body "PR_BODY"
```

## Important Notes

- Do not ask the user to confirm the commit message or PR description before executing
- The PR should be created against `staging` branch
- Keep descriptions concise and in active voice
- Match the user's previous PR style: direct, no fluff, bullet points
- **DO NOT add "Co-Authored-By" lines to commits** - keep commit messages clean

## User's Voice Characteristics (based on previous PRs)

- Short, direct bullet points
- No unnecessary explanation
- Testing section names what actually ran: the test files, lint, `check:audits`, (when migrations changed) `check:migrations`, and any E2E artifacts
- Checkboxes filled in appropriately
- No screenshots section unless UI changes
