# Ship Command

You help ship code by creating commits, pushing to the remote branch, and creating PRs in the user's voice.

## Your Task

When the user runs `/ship`:

1. **Check git status** - See what files have changed
2. **Sync check**: `git fetch origin staging && git log --oneline origin/staging..HEAD`. Read the actual commit list, not just how many there are — it must show ONLY commits you can attribute to this session (recognizable subjects/SHAs). A worktree/branch can silently be cut from a stale local `staging`, dragging in unrelated commits; a corrupted branch's inflated commit *count* can coincidentally match a later check even when the *commits* are wrong, so always compare content, never just a number.
   - If it shows commits you don't recognize, fix it now, **before** staging/committing any new work (step 5 hasn't run yet):
     - If the working tree has uncommitted changes, stash them first — `git stash push -u -m ship-sync-fix` — so the rebase below isn't blocked by dirty state. Restore with `git stash pop` once the branch is fixed.
     - Try `git rebase origin/staging` first.
     - **A rebase finishing without conflicts does NOT by itself mean the branch is clean** — it can replay stray commits onto the new base with no conflict at all. After the rebase (clean or not), re-run `git log --oneline origin/staging..HEAD` and re-check the commit list against what you recognize.
     - If the rebase conflicted on commits you don't recognize, OR it finished cleanly but the re-checked log still shows commits you don't recognize, abandon that result (`git rebase --abort` if still mid-rebase) and rebuild instead: delete any leftover `ship-sync-tmp` branch from an earlier attempt (`git branch -D ship-sync-tmp` — safe, it's disposable), `git checkout -b ship-sync-tmp origin/staging`, `git cherry-pick <only the sha(s) you actually authored this session>`, resolve conflicts, then `git branch -f <original-branch> HEAD`, `git checkout <original-branch>`, and delete `ship-sync-tmp`.
   - Re-verify with `git log --oneline origin/staging..HEAD` — it must list only commits you recognize before you proceed to committing new work.
3. **Generate a commit message** following this format: `type(scope): description`
   - Types: `fix`, `feat`, `improvement`, `chore`
   - Scope: short identifier (e.g., `undo-redo`, `api`, `ui`)
   - Keep it concise

4. **Run pre-ship checks** from the repo root before staging:
   - `bun run lint` to fix formatting issues
   - `bun run check:api-validation:strict` to catch boundary contract failures before CI

5. **Stage and commit** the changes with the generated message

6. **Push to origin** using the current branch name

7. **Create a PR** to staging with a description in the user's voice, then do a final content check — not a count check — comparing what actually landed:
   ```bash
   git log --oneline origin/staging..HEAD
   gh pr view <n> --json commits -q '.commits[].messageHeadline'
   ```
   These two lists must describe the same commits (same subjects, one of which is the commit from step 5). If they don't match, the branch still has a problem — redo step 2's fix and `git push --force-with-lease`.

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
- "Tested manually" is acceptable for testing section; include lint and boundary validation results when run
- Checkboxes filled in appropriately
- No screenshots section unless UI changes
