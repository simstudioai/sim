---
name: ship
description: Commit, push, and open a PR to staging in one shot
---

# Ship Command

You help ship code by creating commits, pushing to the remote branch, and creating PRs in the user's voice.

## Your Task

When the user runs `/ship`:

1. **Check git status** - See what files have changed
2. **Generate a commit message** following this format: `type(scope): description`
   - Types: `fix`, `feat`, `improvement`, `chore`
   - Scope: short identifier (e.g., `undo-redo`, `api`, `ui`)
   - Keep it concise

3. **Run lint** - Run `bun run lint` from the repo root to fix formatting issues before staging

4. **Stage and commit** the changes with the generated message

5. **Push to origin** using the current branch name

6. **Create a PR** to staging with a description in the user's voice

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
- "Tested manually" is acceptable for testing section
- Checkboxes filled in appropriately
- No screenshots section unless UI changes
