import { generateId } from '@sim/utils/id'

/**
 * Build the source->child workflow id map for a fork create, scoped to the deployed workflows whose
 * state actually LOADED (the set the copy loop writes). A deployed source whose state failed to load
 * is EXCLUDED, so a copied workflow's reference to it clears (clearUnmapped) instead of pointing at a
 * never-created child, and no orphan `workspace_fork_resource_map` identity row is seeded for it (the
 * identity seed is derived from this map). Mirrors promote's writtenItems-only scoping
 * (`buildPromoteWorkflowIdMap`). `generateChildId` is injectable for deterministic tests.
 */
export function buildForkWorkflowIdMap(
  deployedWorkflows: ReadonlyArray<{ id: string }>,
  loadedStateWorkflowIds: ReadonlySet<string>,
  generateChildId: () => string = generateId
): Map<string, string> {
  const map = new Map<string, string>()
  for (const wf of deployedWorkflows) {
    if (loadedStateWorkflowIds.has(wf.id)) map.set(wf.id, generateChildId())
  }
  return map
}
