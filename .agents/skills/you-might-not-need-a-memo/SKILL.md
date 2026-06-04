---
name: you-might-not-need-a-memo
description: Analyze and fix useMemo/React.memo anti-patterns in your code
---

# You Might Not Need a Memo

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## References

Read before analyzing:
1. https://overreacted.io/before-you-memo/ — two techniques to avoid memo entirely

## Anti-patterns to detect

1. **Wrapping a slow component in React.memo when state can be moved down**: If a component re-renders because of state it doesn't use, move that state into a smaller child component instead of memoizing. The slow component stops re-rendering without memo.
2. **Wrapping in React.memo when children can be lifted up**: If a parent owns state that changes frequently, extract the stateful part and pass the expensive subtree as `children`. Children passed as props don't re-render when the parent's state changes.
3. **useMemo on cheap computations**: Filtering or mapping a small array, string concatenation, simple arithmetic — these don't need memoization. Only memoize when you've measured a performance problem.
4. **useMemo with constantly-changing deps**: If the dependency array changes on every render, useMemo does nothing — it recalculates every time. Fix the deps or remove the memo.
5. **useMemo to create objects/arrays passed as props**: Instead of memoizing to prevent child re-renders, consider whether the child even needs referential stability. If the child doesn't use React.memo or pass it to a dep array, the memo is wasted.
6. **React.memo on components that always receive new props**: If the parent always passes new objects, arrays, or callbacks, React.memo's shallow comparison always fails. Fix the parent instead of memoizing the child.
7. **useMemo for derived state**: If you're computing a value from props or state, just compute it inline during render. React renders are fast. `const fullName = first + ' ' + last` doesn't need useMemo.

## Steps

1. Read the reference above to understand the two core techniques (move state down, lift content up)
2. Analyze the specified scope for the anti-patterns listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
