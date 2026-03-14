import type { Edge } from 'reactflow'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { isAnnotationOnlyBlock } from '@/executor/constants'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface DroppedEdge {
  edge: Edge
  reason: string
}

export interface EdgeValidationResult {
  valid: Edge[]
  dropped: DroppedEdge[]
}

function isContainerBlock(block: BlockState | undefined): boolean {
  return block?.type === 'loop' || block?.type === 'parallel'
}

function getParentId(block: BlockState | undefined): string | null {
  return block?.data?.parentId ?? null
}

function getScopeDropReason(edge: Edge, blocks: Record<string, BlockState>): string | null {
  const sourceBlock = blocks[edge.source]
  const targetBlock = blocks[edge.target]

  if (!sourceBlock || !targetBlock) {
    return 'edge references a missing block'
  }

  const sourceParent = getParentId(sourceBlock)
  const targetParent = getParentId(targetBlock)

  if (sourceParent === targetParent) {
    return null
  }

  if (targetParent === edge.source && isContainerBlock(sourceBlock)) {
    return null
  }

  if (sourceParent === edge.target && isContainerBlock(targetBlock)) {
    return null
  }

  return `blocks are in different scopes (${sourceParent ?? 'root'} -> ${targetParent ?? 'root'})`
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

    if (isAnnotationOnlyBlock(sourceBlock.type) || isAnnotationOnlyBlock(targetBlock.type)) {
      dropped.push({ edge, reason: 'edge references an annotation-only block' })
      continue
    }

    if (TriggerUtils.isTriggerBlock(targetBlock)) {
      dropped.push({ edge, reason: 'trigger blocks cannot be edge targets' })
      continue
    }

    const scopeDropReason = getScopeDropReason(edge, blocks)
    if (scopeDropReason) {
      dropped.push({ edge, reason: scopeDropReason })
      continue
    }

    valid.push(edge)
  }

  return { valid, dropped }
}
