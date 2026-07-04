import type { TableSchema } from '@/lib/table/types'
import {
  deriveForkBlockId,
  type ForkBlockIdResolver,
} from '@/lib/workspaces/fork/remap/block-identity'

/**
 * Remap the workflow/block references embedded in a copied table's schema so its
 * workflow groups keep working in the child workspace. `workflowGroups[].workflowId`
 * is rewritten through the source→child workflow identity map, and each
 * `outputs[].blockId` is rewritten through `resolveBlockId` - which MUST be the
 * same resolver that assigns the target workflows' block ids, or the outputs
 * point at nonexistent blocks. Fork-create omits it and defaults to the
 * deterministic {@link deriveForkBlockId} (a fresh child has no persisted
 * pairs, matching `copyWorkflowStateIntoTarget`); promote passes its
 * persisted-pair resolver (a push keeps the parent's ORIGINAL block ids, which
 * never equal the derive). Manual groups whose backing workflow was not
 * copied are dropped, and any columns wired to a dropped group have their
 * `workflowGroupId` cleared. Enrichment groups (empty `workflowId`) and column
 * ids are left untouched.
 */
export function remapForkTableWorkflowGroups(
  schema: TableSchema,
  workflowIdMap: Map<string, string>,
  resolveBlockId: ForkBlockIdResolver = deriveForkBlockId
): TableSchema {
  const groups = schema.workflowGroups ?? []
  if (groups.length === 0) return schema

  const droppedGroupIds = new Set<string>()
  const remappedGroups = groups.flatMap((group) => {
    if (!group.workflowId) return [group]
    const childWorkflowId = workflowIdMap.get(group.workflowId)
    if (!childWorkflowId) {
      droppedGroupIds.add(group.id)
      return []
    }
    return [
      {
        ...group,
        workflowId: childWorkflowId,
        outputs: group.outputs.map((output) => ({
          ...output,
          blockId: output.blockId
            ? resolveBlockId(childWorkflowId, output.blockId)
            : output.blockId,
        })),
      },
    ]
  })

  const columns =
    droppedGroupIds.size === 0
      ? schema.columns
      : schema.columns.map((column) =>
          column.workflowGroupId && droppedGroupIds.has(column.workflowGroupId)
            ? { ...column, workflowGroupId: undefined }
            : column
        )

  return { ...schema, columns, workflowGroups: remappedGroups }
}
