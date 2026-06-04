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

## The one rule that matters

`useCallback` is only useful when **something observes the reference**. Ask: does anything care if this function gets a new identity on re-render?

Observers that care about reference stability:
- A `useEffect` that lists the function in its deps array
- A `useMemo` that lists the function in its deps array
- Another `useCallback` that lists the function in its deps array
- A child component wrapped in `React.memo` that receives the function as a prop

If none of those apply — if the function is only called inline, or passed to a non-memoized child, or assigned to a native element event — the reference is unobserved and `useCallback` adds overhead with zero benefit.

## Anti-patterns to detect

1. **No observer tracks the reference**: The function is only called inline in the same component, or passed to a non-memoized child, or used as a native element handler (`<button onClick={fn}>`). Nothing re-runs or bails out based on reference identity. Remove `useCallback`.
2. **useCallback with deps that change every render**: If a dep is a plain object/array created inline, or state that changes on every interaction, memoization buys nothing — the function gets a new identity anyway.
3. **useCallback on handlers passed only to native elements**: `<button onClick={fn}>` — React never does reference equality on native element props. No benefit.
4. **useCallback wrapping functions that return new objects/arrays**: Stable function identity, unstable return value — memoization is at the wrong level. Use `useMemo` on the return value instead, or restructure.
5. **useCallback with empty deps when deps are needed**: Stale closure — reads initial values forever. This is a correctness bug, not just a performance issue.
6. **Pairing useCallback + React.memo on trivially cheap renders**: If the child renders in < 1ms and re-renders rarely, the memo infrastructure costs more than it saves.

## Patterns that ARE correct — do not flag

- `useCallback` whose result is in a `useEffect` dep array — prevents the effect from re-running on every render
- `useCallback` whose result is in a `useMemo` dep array — prevents the memo from recomputing on every render
- `useCallback` whose result is a dep of another `useCallback` — stabilises a callback chain
- `useCallback` passed to a `React.memo`-wrapped child — the whole point of the pattern
- This codebase's ref pattern: `useRef` + callback with empty deps that reads the ref inside — correct, do not flag

## Steps

1. Read the reference above
2. Analyze the specified scope for the anti-patterns listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
