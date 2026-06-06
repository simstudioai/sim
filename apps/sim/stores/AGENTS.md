# Stores Scope

Applies to Zustand stores under `apps/sim/**/stores/**` and `apps/sim/**/store.ts`.

Store authoring rules — `devtools` middleware, `persist` + `partialize` only for reload-surviving state, immutable updates, `set((state) => ...)` for previous-state-dependent updates, `reset()` action, splitting complex stores into `store.ts` + `types.ts`, and `_hasHydrated` tracking — live in `.claude/rules/sim-stores.md`.
