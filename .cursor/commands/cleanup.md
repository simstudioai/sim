# Cleanup

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Steps

Run each of these skills in order on the specified scope, passing through the scope and fix arguments. After each skill completes, move to the next. Do not skip any.

1. `/you-might-not-need-an-effect $ARGUMENTS`
2. `/you-might-not-need-a-memo $ARGUMENTS`
3. `/you-might-not-need-a-callback $ARGUMENTS`
4. `/you-might-not-need-state $ARGUMENTS`
5. `/react-query-best-practices $ARGUMENTS`
6. `/emcn-design-review $ARGUMENTS`

After all skills have run, output a summary of what was found and fixed (or proposed) across all six passes.
