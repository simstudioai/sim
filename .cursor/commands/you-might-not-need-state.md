# You Might Not Need State

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses React Query for all server state and Zustand for client-only global state. useState should only be used for ephemeral UI concerns (open/closed, hover, local form input). Server data should never be copied into useState or Zustand — React Query is the single source of truth.

## References

Read these before analyzing:
1. https://react.dev/learn/choosing-the-state-structure — 5 principles for structuring state
2. https://tkdodo.eu/blog/dont-over-use-state — never store derived/computed values in state
3. https://tkdodo.eu/blog/putting-props-to-use-state — never mirror props into state via useEffect

## Anti-patterns to detect

1. **Derived state stored in useState**: If a value can be computed from props, other state, or query data, compute it inline during render instead of storing it in state.
2. **Server state copied into useState**: Never `useState` + `useEffect` to sync React Query data into local state. Use query data directly. The only exception is forms where users edit server data.
3. **Props mirrored into state**: Never `useState(prop)` + `useEffect(() => setState(prop))`. Use the prop directly, or use a key to reset component state.
4. **Chained useEffect state updates**: Never chain Effects that set state to trigger other Effects. Calculate all derived values in the event handler or inline during render.
5. **Storing objects when an ID suffices**: Store `selectedId` not a copy of the selected object. Derive the object: `items.find(i => i.id === selectedId)`.
6. **State that duplicates Zustand or React Query**: If the data already lives in a store or query cache, don't create a parallel useState.

## Steps

1. Read the references above to understand the guidelines
2. Analyze the specified scope for the anti-patterns listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
