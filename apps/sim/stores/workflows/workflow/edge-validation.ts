import {
  getWorkflowEdgeScopeDropReason,
  isWorkflowAnnotationOnlyBlockType,
} from '@sim/workflow-types/workflow'
import type { Edge } from 'reactflow'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface DroppedEdge {
  edge: Edge
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
      dropped.push({ edge, reason: 'edge references a missing block' })
      continue
    }

    if (
      isWorkflowAnnotationOnlyBlockType(sourceBlock.type) ||
      isWorkflowAnnotationOnlyBlockType(targetBlock.type)
    ) {
      dropped.push({ edge, reason: 'edge references an annotation-only block' })
      continue
    }

    if (TriggerUtils.isTriggerBlock(targetBlock)) {
      dropped.push({ edge, reason: 'trigger blocks cannot be edge targets' })
      continue
    }

    const scopeDropReason = getWorkflowEdgeScopeDropReason(edge, blocks)
    if (scopeDropReason) {
      dropped.push({ edge, reason: scopeDropReason })
      continue
    }

    valid.push(edge)
  }

  return { valid, dropped }
}
