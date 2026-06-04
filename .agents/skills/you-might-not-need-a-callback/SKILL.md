---
name: you-might-not-need-a-callback
description: Analyze and fix useCallback anti-patterns in your code
---

# You Might Not Need a Callback

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## References

Read before analyzing:
1. https://react.dev/reference/react/useCallback — official docs on when useCallback is actually needed

## When useCallback IS needed

- Passing a callback to a child wrapped in `React.memo` (to preserve referential equality)
- The callback is a dependency of another hook (`useEffect`, `useMemo`)
- The callback is used in a custom hook that documents referential stability requirements

## Anti-patterns to detect

1. **useCallback on functions not passed as props or deps**: If the function is only called within the same component and isn't in any dependency array, useCallback adds overhead for no benefit. Just declare the function normally.
2. **useCallback with exhaustive deps that change every render**: If the dependency array includes values that change on every render, useCallback recalculates every time. The memoization is wasted. Either stabilize the deps (use refs) or remove the useCallback.
3. **useCallback on event handlers passed to native elements**: `<button onClick={handleClick}>` — native elements don't benefit from stable references. Only child components wrapped in React.memo do.
4. **useCallback wrapping a function that creates new objects/arrays**: If the callback returns `{ ...newObj }` or `[...newArr]`, memoizing the callback doesn't prevent the child from re-rendering due to new return values. The memoization is at the wrong level.
5. **useCallback with an empty dep array when deps are needed**: Stale closures — the callback captures outdated values. Either add proper deps or use refs for values that shouldn't trigger re-creation.
6. **Pairing useCallback with React.memo unnecessarily**: If the child component is cheap to render, neither useCallback nor React.memo adds value. Only optimize when you've measured a performance problem.
7. **useCallback in custom hooks that don't need stable references**: Not every hook return needs to be memoized. Only stabilize callbacks when consumers depend on referential equality.

## Codebase-specific notes

This codebase uses a ref pattern for stable callbacks in hooks:
```tsx
const idRef = useRef(id)
useEffect(() => { idRef.current = id }, [id])
const fetchData = useCallback(async () => {
  // use idRef.current instead of id
}, []) // empty deps because refs are used
```
This pattern is correct — don't flag it as an anti-pattern.

## Steps

1. Read the reference above
2. Analyze the specified scope for the anti-patterns listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
