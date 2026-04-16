---
description: Analyze and fix useCallback anti-patterns in your code
argument-hint: [scope] [fix=true|false]
---

# You Might Not Need a Callback

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## References

Read before analyzing:
1. https://react.dev/reference/react/useCallback — official docs on when useCallback is actually needed

## Anti-patterns to detect

1. **useCallback on functions not passed as props or deps**: No benefit if only called within the same component.
2. **useCallback with deps that change every render**: Memoization is wasted.
3. **useCallback on handlers passed to native elements**: `<button onClick={fn}>` doesn't benefit from stable references.
4. **useCallback wrapping functions that return new objects/arrays**: Memoization at the wrong level.
5. **useCallback with empty deps when deps are needed**: Stale closures.
6. **Pairing useCallback + React.memo unnecessarily**: Only optimize when you've measured a problem.
7. **useCallback in hooks that don't need stable references**: Not every hook return needs memoization.

Note: This codebase uses a ref pattern for stable callbacks (`useRef` + empty deps). That pattern is correct — don't flag it.

## Steps

1. Read the reference above
2. Analyze the specified scope for the anti-patterns listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
