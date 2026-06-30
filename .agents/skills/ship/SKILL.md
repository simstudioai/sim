---
name: ship
description: Commit, push, and open a PR to staging in one shot — runs the cleanup pass and, when migrations changed, the db-migrate safety review first
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
3. **Run the cleanup pass** — only if the diff modifies UI code (any `.tsx` file, or anything under `apps/sim/components/`, `apps/sim/hooks/`, or `apps/sim/stores/`): `/cleanup`
  - The six code-quality skills (effects, memo, callbacks, state, React Query, emcn) only apply to React code, so skip this step entirely when no UI was touched. When it runs, it applies fixes so they land in this commit.
4. **Run migration safety** — only if the diff touches `packages/db/migrations/**` or `packages/db/schema.ts`:
  - Run `/db-migrate` to review the migration for zero-downtime safety (expand/contract phasing, backward-compatibility with the deployed app version).
  - `bun run check:migrations origin/staging` must pass (staging is the PR base). Do not silence a flagged statement with a `-- migration-safe:` annotation unless `/db-migrate` confirmed the old code no longer depends on it; otherwise split the destructive change into a later deploy.
5. **Run pre-ship checks** from the repo root before staging:
  - `bun run lint` to fix formatting issues
  - `bun run check:api-validation:strict` to catch boundary contract failures before CI
6. **Stage and commit** the changes with the generated message
7. **Push to origin** using the current branch name
8. **Create a PR** to staging with a description in the user's voice

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

