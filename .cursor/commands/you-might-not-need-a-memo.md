# You Might Not Need a Memo

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## References

Read before analyzing:
1. https://overreacted.io/before-you-memo/ — two techniques to avoid memo entirely

## Anti-patterns to detect

1. **State can be moved down instead of memoizing**: Move state into a smaller child so the slow component stops re-rendering without memo.
2. **Children can be lifted up**: Extract stateful part, pass expensive subtree as `children` — children as props don't re-render when parent state changes.
3. **useMemo on cheap computations**: Small array filters, string concat, arithmetic don't need memoization.
4. **useMemo with constantly-changing deps**: Deps change every render = useMemo does nothing.
5. **useMemo to stabilize props for non-memoized children**: If the child isn't wrapped in React.memo, stable references don't matter.
6. **React.memo on components that always receive new props**: Fix the parent instead.
7. **useMemo for derived state**: Just compute inline during render.

## Steps

1. Read the reference above
2. Analyze the specified scope for the anti-patterns listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
