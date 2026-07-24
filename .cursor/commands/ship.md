# Ship Command

You help ship code by creating commits, pushing to the remote branch, and creating PRs in the user's voice.

## Your Task

When the user runs `/ship`:

1. **Check git status** - See what files have changed
2. **Sync check**: `git fetch origin staging && git log --oneline origin/staging..HEAD`. Read the actual commit list, not just how many there are — it must show ONLY commits you can attribute to this session (recognizable subjects/SHAs). A worktree/branch can silently be cut from a stale local `staging`, dragging in unrelated commits; a corrupted branch's inflated commit *count* can coincidentally match a later check even when the *commits* are wrong, so always compare content, never just a number.
   - If it shows commits you don't recognize, fix it now, **before** staging/committing any new work (step 7 hasn't run yet):
     - If the working tree has uncommitted changes, stash them first — `git stash push -u -m ship-sync-fix` — so the rebase below isn't blocked by dirty state. Restore with `git stash pop` once the branch is fixed.
     - Try `git rebase origin/staging` first.
     - **A rebase finishing without conflicts does NOT by itself mean the branch is clean** — it can replay stray commits onto the new base with no conflict at all. After the rebase (clean or not), re-run `git log --oneline origin/staging..HEAD` and re-check the commit list against what you recognize.
     - If the rebase conflicted on commits you don't recognize, OR it finished cleanly but the re-checked log still shows commits you don't recognize, abandon that result (`git rebase --abort` if still mid-rebase) and rebuild instead, in this exact order:
       1. **While still on `<original-branch>`**, identify the SHA(s) to preserve — **not** the whole range. `git log --oneline --reverse origin/staging..<original-branch>` lists everything ahead of `origin/staging`, but in exactly this scenario that range also contains the unrecognized/stray commits you're trying to leave behind — blindly cherry-picking the full range recreates the same polluted branch. Read the list and write down only the SHA(s) you recognize as your own session's work (e.g. `abc1234 def5678`); do this *before* touching any temp branch, since once you check out `ship-sync-tmp` at `origin/staging` in step 4, `HEAD` no longer contains these commits and the same lookup at that point returns nothing.
       2. `git checkout <original-branch>` — harmless no-op if you're already there, but required if an earlier interrupted attempt left you sitting on `ship-sync-tmp`: git refuses to delete the branch you're currently on, so deleting it before switching away silently fails and blocks the rest of the rebuild.
       3. Delete any leftover from an earlier attempt: `git branch -D ship-sync-tmp 2>/dev/null || true` — always succeeds, including when there's nothing to delete (a first attempt), so it never blocks the rest of the rebuild on its own exit code.
       4. `git checkout -b ship-sync-tmp origin/staging`.
       5. `git cherry-pick` the SHAs captured in step 1, **in that oldest-first order** — cherry-picking more than one session commit out of order can fail or produce the wrong history. Resolve conflicts.
       6. `git branch -f <original-branch> HEAD`, `git checkout <original-branch>`, and delete `ship-sync-tmp` (`git branch -D ship-sync-tmp`).
   - Re-verify with `git log --oneline origin/staging..HEAD` — it must list only commits you recognize before you proceed to committing new work.
3. **Generate a commit message** following this format: `type(scope): description`
  - Types: `fix`, `feat`, `improvement`, `chore`
  - Scope: short identifier (e.g., `undo-redo`, `api`, `ui`)
  - Keep it concise
4. **Run the cleanup pass** — only if the diff modifies UI code (any `.tsx` file, or anything under `apps/sim/components/`, `apps/sim/hooks/`, or `apps/sim/stores/`): `/cleanup`
  - The six code-quality skills (effects, memo, callbacks, state, React Query, emcn) only apply to React code, so skip this step entirely when no UI was touched. When it runs, it applies fixes so they land in this commit.
5. **Run migration safety** — only if the diff touches `packages/db/migrations/**` or `packages/db/schema.ts`:
  - Run `/db-migrate` to review the migration for zero-downtime safety (expand/contract phasing, backward-compatibility with the deployed app version).
  - `bun run check:migrations origin/staging` must pass (staging is the PR base). Do not silence a flagged statement with a `-- migration-safe:` annotation unless `/db-migrate` confirmed the old code no longer depends on it; otherwise split the destructive change into a later deploy.
6. **Run pre-ship checks** from the repo root before staging. This has two phases: first **regenerate** every committed artifact so generated files never drift into a CI failure (this is what catches things like `agent-stream-docs` going stale after a `models.ts` edit), then run the **full audit suite** CI's `Lint and Test` job enforces. Both phases parallelize — but only across commands that write **disjoint** outputs — and a bare `wait` swallows child exit codes, so both phases below explicitly collect each job's status and abort ship if any failed.

  **Phase A — regenerate the always-in-repo committed artifacts (parallel), then let step 7 stage whatever changed.** Regenerate only the generators whose inputs live entirely in this repo and that any ordinary code change can drift — `agent-stream-docs:generate` (derives from the provider model registry) and `skills:sync` (derives from `.agents/skills/**`). They write disjoint trees (`apps/docs/…/agent.mdx` vs the `.claude`/`.cursor` command projections), so they parallelize safely, and each is idempotent (a no-op when already in sync):
  ```bash
  rm -f /tmp/ship-gen-results
  for g in agent-stream-docs:generate skills:sync; do
    ( bun run "$g" >"/tmp/ship-gen-${g//:/-}.log" 2>&1; echo "$? $g" >>/tmp/ship-gen-results ) &
  done
  wait
  # any non-zero line is a FAILED generator — read /tmp/ship-gen-<name>.log and fix before shipping;
  # a silently-failed generate leaves a stale artifact that Phase B / CI then rejects.
  # The `exit 1` makes this block itself exit non-zero on failure, so anything gating on the
  # command's status (an agent, or a wrapping script) actually stops — do NOT collapse it to
  # `grep … && echo ❌ || echo ✅`, which always exits 0 and silently lets ship continue.
  if grep -vE '^0 ' /tmp/ship-gen-results; then echo "❌ generator(s) failed — do not ship"; exit 1; fi
  echo "✅ artifacts regenerated"
  ```
  Then `git status --short` to see what regenerated — those files must be staged in step 7 alongside your own changes.

  **Do NOT blanket-run the domain generators here.** `mship:generate` (`generate-mship-contracts.ts`) is an **umbrella** that drives all nine mothership contract generators (`mship-contracts`, `billing-protocol-contract`, `mship-tools`, the four `trace-*`, `metrics-contract`, `vfs-snapshot-contract`) and biome-formats `apps/sim/lib/copilot/generated/` — never run it *and* its constituents (they write the same files and corrupt each other in parallel), and never run it on an ordinary ship: it reads an **external** copilot-contract source that isn't checked out in most worktrees, so it hard-fails with `ENOENT` and would abort ship for an unrelated reason. `generate:pi-model-catalog` (under `apps/sim`) likewise regenerates from the installed Pi package, not repo source. Only when **this PR's diff actually touches** a domain generator's input do you regenerate it deliberately and run its matching `:check` (`bun run mship:check` / the individual `*:check`) — with the external source present.

  **Phase B — run lint + every audit CI enforces, in parallel, and abort ship if any fails.** `bun run lint` first (it autofixes formatting and mutates files, so don't parallelize it with the read-only audits), then fan the rest out and collect exit codes. This is exactly the read-only audit set from CI's `Lint and Test` job (all in-repo, runnable in any worktree):
  ```bash
  bun run lint   # autofix formatting first (mutating; not parallel-safe with the audits)
  rm -f /tmp/ship-audit-results
  for s in check:boundaries check:api-validation:strict check:utils check:zustand-v5 \
           check:react-query check:client-boundary check:bare-icons check:icon-paths \
           check:realtime-prune skills:check agent-stream-docs:check; do
    ( bun run "$s" >"/tmp/ship-audit-${s//:/-}.log" 2>&1; echo "$? $s" >>/tmp/ship-audit-results ) &
  done
  wait
  # any non-zero line is a failing audit — read its /tmp/ship-audit-<name>.log and fix before shipping.
  # `exit 1` on failure preserves the original sequential checks' semantics (their non-zero exit is
  # what an agent gates on); never use `grep … && echo ❌ || echo ✅` here — it always exits 0.
  if grep -vE '^0 ' /tmp/ship-audit-results; then echo "❌ audit(s) failed — do not ship"; exit 1; fi
  echo "✅ all audits passed"
  ```
  If Phase A regenerated a file, its matching `:check` in Phase B now passes trivially — that parity is the point. Do not ship with any generator or audit failing; fix the cause (never silence it) and re-run. `check:migrations` and `type-check` are covered by steps 5 and CI respectively and are not repeated here.
7. **Stage and commit** the changes with the generated message — including any files Phase A regenerated in step 6
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
   still has a problem — redo step 2's fix and `git push --force-with-lease`.

## Commit Message Format

Based on the repo's commit history:

```
fix(scope): description for bug fixes
feat(scope): description for new features
improvement(scope): description for enhancements
chore(scope): description for maintenance
```

## PR Description Format

Use this exact template in the user's voice (concise, bullet points):

```markdown
## Summary
- bullet point describing what changed
- another bullet point if needed

## Type of Change
- [x] Bug fix (or appropriate type)

## Testing
Tested manually (or describe testing)

## Checklist
- [x] Code follows project style guidelines
- [x] Self-reviewed my changes
- [ ] Tests added/updated and passing
- [x] No new warnings introduced
- [x] I confirm that I have read and agree to the terms outlined in the [Contributor License Agreement (CLA)](./CONTRIBUTING.md#contributor-license-agreement-cla)
```

## PR Creation Command

Use this command structure:

```bash
gh pr create --base staging --title "COMMIT_MESSAGE" --body "PR_BODY"
```

## Important Notes

- Always confirm the commit message and PR description with the user before executing
- The PR should be created against `staging` branch
- Keep descriptions concise and in active voice
- Match the user's previous PR style: direct, no fluff, bullet points
- **DO NOT add "Co-Authored-By" lines to commits** - keep commit messages clean

## User's Voice Characteristics (based on previous PRs)

- Short, direct bullet points
- No unnecessary explanation
- "Tested manually" is acceptable for testing section; include lint, boundary validation, and (when migrations changed) `check:migrations` results when run
- Checkboxes filled in appropriately
- No screenshots section unless UI changes
