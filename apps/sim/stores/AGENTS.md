# Stores Scope

These rules apply to Zustand stores under `apps/sim/**/stores/**` and `apps/sim/**/store.ts`.

- Use `devtools` middleware for stores unless there is a clear reason not to.
- Use `persist` only when state should survive reloads.
- When persisting, use `partialize` to store only the minimum required fields.
- Use immutable updates only.
- Use `set((state) => ...)` when the next value depends on previous state.
- Expose a `reset()` action for non-trivial stores.
- Split more complex stores into `store.ts` and `types.ts`.
- Use hydration tracking such as `_hasHydrated` when persisted stores need it.
