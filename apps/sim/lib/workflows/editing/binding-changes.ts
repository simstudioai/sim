import type { BlockState } from '@sim/workflow-types/workflow'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'

export interface RemovedWorkflowBinding {
  blockId: string
  blockName: string
  field: string
  valuePath: Array<string | number>
  kind: 'credential' | 'table'
  resourceId: string
}

/**
 * Compares registered binding identifiers only. Never copies credential values or arbitrary
 * sub-block content. Moving an existing binding between active modes in one block retains it.
 */
export function collectRemovedWorkflowBindings(
  previous: Record<string, BlockState>,
  next: Record<string, BlockState>
): RemovedWorkflowBinding[] {
  const retained = new Set<string>()
  for (const reference of buildWorkflowReferenceManifest(next).references) {
    if (reference.kind !== 'credential' && reference.kind !== 'table') continue
    for (const occurrence of reference.occurrences) {
      retained.add(JSON.stringify([occurrence.blockId, reference.kind, reference.sourceId]))
    }
  }
  const removed: RemovedWorkflowBinding[] = []
  for (const reference of buildWorkflowReferenceManifest(previous).references) {
    if (reference.kind !== 'credential' && reference.kind !== 'table') continue
    for (const occurrence of reference.occurrences) {
      if (retained.has(JSON.stringify([occurrence.blockId, reference.kind, reference.sourceId])))
        continue
      removed.push({
        blockId: occurrence.blockId,
        blockName: previous[occurrence.blockId]?.name || occurrence.blockId,
        field: occurrence.subBlockKey,
        valuePath: occurrence.valuePath,
        kind: reference.kind,
        resourceId: reference.sourceId,
      })
    }
  }
  return removed
}
