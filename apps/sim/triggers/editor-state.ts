/**
 * Editor-state readers for trigger sub-block option resolvers.
 *
 * Trigger definitions are a definition layer: `@/triggers` must not reach `@/blocks`
 * through a static import, because block configs spread `getTrigger(...).subBlocks` at
 * module scope. A static edge makes the two barrels mutually recursive, and whichever
 * one an entry point reaches first wins — enter through `@/triggers` and `getTrigger()`
 * runs before `TRIGGER_REGISTRY` is initialized, throwing
 * `ReferenceError: Cannot access 'TRIGGER_REGISTRY' before initialization`.
 *
 * The Zustand stores below sit on the far side of that edge (`subblock/store` imports
 * `@/blocks`), so they are loaded with a dynamic `import()`. Dynamic imports resolve at
 * call time rather than during module evaluation, so they carry no initialization-order
 * obligation. Every caller is an editor-side `fetchOptions`/`fetchOptionById` resolver
 * that already runs asynchronously, long after both registries are built.
 *
 * `scripts/check-trigger-block-cycle.ts` fails the build if a static edge reappears.
 */

/** The value the user has entered for `subBlockId` on `blockId` in the open workflow. */
export async function readSubBlockValue(blockId: string, subBlockId: string): Promise<unknown> {
  const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
  return useSubBlockStore.getState().getValue(blockId, subBlockId)
}

/**
 * Every stored sub-block value for `blockId`, for resolvers that read several fields at
 * once. Returns `undefined` when the block has no stored values yet.
 */
export async function readBlockValues(
  blockId: string
): Promise<Record<string, unknown> | undefined> {
  const [{ useSubBlockStore }, { useWorkflowRegistry }] = await Promise.all([
    import('@/stores/workflows/subblock/store'),
    import('@/stores/workflows/registry/store'),
  ])
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) return undefined
  return useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]
}

/** The active workspace's workflows, for trigger sub-blocks that select other workflows. */
export async function readWorkspaceWorkflowOptions(options?: {
  excludeActiveWorkflow?: boolean
}): Promise<Array<{ label: string; id: string }>> {
  const { fetchWorkspaceWorkflowOptions } = await import('@/lib/workflows/subblocks/options')
  return fetchWorkspaceWorkflowOptions(options)
}

/** The workflow and workspace the editor currently has open. */
export async function readActiveWorkflowContext(): Promise<{
  activeWorkflowId: string | null
  workspaceId: string | null
}> {
  const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
  const state = useWorkflowRegistry.getState()
  return {
    activeWorkflowId: state.activeWorkflowId,
    workspaceId: state.hydration.workspaceId,
  }
}
