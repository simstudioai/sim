# Ship Command

You help ship code by creating commits, pushing to the remote branch, and creating PRs in the user's voice.

## Your Task

When the user runs `/ship`:

1. **Check git status** - See what files have changed
2. **Sync check**: `git fetch origin staging && git log --oneline origin/staging..HEAD`. Must list only this session's commit(s) — a worktree/branch can silently be cut from a stale local `staging`, dragging in unrelated commits. If it shows extra commits, fix before pushing: `git rebase origin/staging`; if that hits conflicts on commits you don't recognize, `git rebase --abort` and instead `git checkout -b tmp origin/staging`, `git cherry-pick <your-sha(s)>`, resolve conflicts, then `git branch -f <branch> HEAD && git checkout <branch>` and `git push --force-with-lease`.
3. **Generate a commit message** following this format: `type(scope): description`
   - Types: `fix`, `feat`, `improvement`, `chore`
   - Scope: short identifier (e.g., `undo-redo`, `api`, `ui`)
   - Keep it concise

4. **Run pre-ship checks** from the repo root before staging:
   - `bun run lint` to fix formatting issues
   - `bun run check:api-validation:strict` to catch boundary contract failures before CI

5. **Stage and commit** the changes with the generated message

6. **Push to origin** using the current branch name

7. **Create a PR** to staging with a description in the user's voice, then confirm `gh pr view <n> --json commits -q '.commits | length'` matches the commit count from step 2 — otherwise redo the sync fix and force-push

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
