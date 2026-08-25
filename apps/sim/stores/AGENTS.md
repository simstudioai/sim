# Stores Scope

Applies to Zustand stores under `apps/sim/**/stores/**` and `apps/sim/**/store.ts`.

Store authoring rules — `devtools` middleware, `persist` + `partialize` only for reload-surviving state, immutable updates, `set((state) => ...)` for previous-state-dependent updates, `reset()` action, splitting complex stores into `store.ts` + `types.ts`, and `_hasHydrated` tracking — live in `.claude/rules/sim-stores.md`.

## Workflow value state invariants

Workflow state is split across two stores on purpose: `useWorkflowStore` holds block
structure (plus a hydration-time copy of each subblock value) and `useSubBlockStore`
holds live values, so per-keystroke edits don't re-render the canvas. Rules that keep
this split correct:

- The structure's `subBlocks[*].value` is stale after any edit. Never read it directly
  for a current value — merge via `mergeSubblockState`/`mergeSubblockStateWithValues`
  (single implementation in `@sim/workflow-persistence/subblocks`) or read the
  subblock store. Exception: condition/router dynamic-handle subblocks dual-write the
  structure (`syncDynamicHandleSubblockValue`) and may be read from either source.
- Merge semantics are tri-state: a key present in the subblock store wins — including
  `null`, which means "explicitly cleared". Absent/`undefined` falls back to the
  structure. Do not add merge or precedence logic anywhere else; if a new reader needs
  different semantics, extend the shared merge.
- Every subblock-store write must go through `collaborativeSetSubblockValue` (or a
  batch equivalent) so the identical value is persisted via the realtime server. A
  store write that skips persistence makes the client's merged state diverge from the
  DB draft, which deploy snapshots — producing phantom "Update" states on the deploy
  button that clear on refresh. Hydration-derived local-only writes are allowed only
  when change detection compensates, and the exemption list in the store's own
  docstring (`workflows/subblock/store.ts`) is the record of which ones do and why —
  keep the two in step.
- Change detection compensates by resolving each subblock value to the configuration
  it represents (`lib/workflows/canonical/`), so a blank value and a value equal to
  the field's declared `defaultValue` compare equal. It does NOT compensate for a
  local-only write of a value the user could have chosen. If you cannot name the
  declared default your write matches, it is not exempt.
- Deploy materializes declared defaults into `webhook.providerConfig`, so anything
  reading a derived artifact back into the store is writing values the DB draft does
  not have. That circularity is the origin of this whole failure mode; prefer not
  reading derived artifacts back at all.
