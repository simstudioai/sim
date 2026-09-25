import type { BlockState } from '@sim/workflow-types/workflow'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import { createCanonicalModeGates } from '@/lib/workflows/references/remap-references'
import { getWorkflowSearchSubBlockResourceKind } from '@/lib/workflows/search-replace/resources/registry'
import {
  buildCanonicalIndexForSurface,
  buildSubBlockValues,
  getCanonicalValues,
  isSubBlockVisibleForTriggerMode,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'

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
 * Manual IDs supplement retention only; the portability manifest still owns binding detection.
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
  for (const block of Object.values(next)) {
    const config = getBlock(block.type)
    if (!config) continue
    const triggerMode = block.triggerMode === true
    const subBlocks = config.subBlocks.filter((field) =>
      isSubBlockVisibleForTriggerMode(field, triggerMode, config)
    )
    const definitions = new Map(subBlocks.map((field) => [field.id, field]))
    const values = buildSubBlockValues(block.subBlocks)
    const modes = block.data?.canonicalModes
    const gates = createCanonicalModeGates(subBlocks, values, modes, triggerMode)
    const index = buildCanonicalIndexForSurface(subBlocks, triggerMode)
    for (const group of Object.values(index.groupsById)) {
      if (!group.basicId) continue
      const kind = getWorkflowSearchSubBlockResourceKind(definitions.get(group.basicId))
      if (kind !== 'oauth-credential' && kind !== 'table') continue
      const { advancedSourceId } = getCanonicalValues(group, values)
      if (
        !advancedSourceId ||
        !gates.isActiveManualMember(advancedSourceId) ||
        gates.isConditionHidden(advancedSourceId)
      )
        continue
      const sourceId = resolveActiveCanonicalValue(group, values, modes)
      if (typeof sourceId === 'string') {
        retained.add(
          JSON.stringify([block.id, kind === 'oauth-credential' ? 'credential' : kind, sourceId])
        )
      }
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
