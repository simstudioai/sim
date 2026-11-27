import {
  getWorkflowEdgeScopeDropReason,
  isWorkflowAnnotationOnlyBlockType,
} from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Why an edge was dropped; `scope` is an edge crossing a loop's or parallel's boundary. */
export type DroppedEdgeKind = 'missing_block' | 'annotation_only' | 'trigger_target' | 'scope'

interface DroppedEdge {
  edge: Edge
  kind: DroppedEdgeKind
  reason: string
}

export interface EdgeValidationResult {
  valid: Edge[]
  dropped: DroppedEdge[]
}

export function validateEdges(
  edges: Edge[],
  blocks: Record<string, BlockState>
): EdgeValidationResult {
  const valid: Edge[] = []
  const dropped: DroppedEdge[] = []

  for (const edge of edges) {
    const sourceBlock = blocks[edge.source]
    const targetBlock = blocks[edge.target]

    if (!sourceBlock || !targetBlock) {
      dropped.push({ edge, kind: 'missing_block', reason: 'edge references a missing block' })
      continue
    }

    if (
      isWorkflowAnnotationOnlyBlockType(sourceBlock.type) ||
      isWorkflowAnnotationOnlyBlockType(targetBlock.type)
    ) {
      dropped.push({
        edge,
        kind: 'annotation_only',
        reason: 'edge references an annotation-only block',
      })
      continue
    }

    if (TriggerUtils.isTriggerBlock(targetBlock)) {
      dropped.push({
        edge,
        kind: 'trigger_target',
        reason: 'trigger blocks cannot be edge targets',
      })
      continue
    }

    const scopeDropReason = getWorkflowEdgeScopeDropReason(edge, blocks)
    if (scopeDropReason) {
      dropped.push({ edge, kind: 'scope', reason: scopeDropReason })
      continue
    }

    valid.push(edge)
  }

  return { valid, dropped }
}
