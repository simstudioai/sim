import type { Edge, Node } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { clampPositionToContainer } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/node-position-utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Checks if the currently focused element is an editable input.
 * Returns true if the user is typing in an input, textarea, or contenteditable element.
 */
export function isInEditableElement(): boolean {
  const activeElement = document.activeElement
  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement?.hasAttribute('contenteditable') === true
  )
}

interface TriggerValidationResult {
  isValid: boolean
  message?: string
}

/**
 * Validates that pasting/duplicating blocks won't violate constraints.
 * Checks both trigger constraints and single-instance block constraints.
 * Returns validation result with error message if invalid.
 */
export function validateTriggerPaste(
  blocksToAdd: Array<{ type: string }>,
  existingBlocks: Record<string, BlockState>,
  action: 'paste' | 'duplicate'
): TriggerValidationResult {
  for (const block of blocksToAdd) {
    if (TriggerUtils.isAnyTriggerType(block.type)) {
      const issue = TriggerUtils.getTriggerAdditionIssue(existingBlocks, block.type)
      if (issue) {
        const actionText = action === 'paste' ? 'paste' : 'duplicate'
        const message =
          issue.issue === 'legacy'
            ? `Cannot ${actionText} trigger blocks when a legacy Start block exists.`
            : `A workflow can only have one ${issue.triggerName} trigger block. ${action === 'paste' ? 'Please remove the existing one before pasting.' : 'Cannot duplicate.'}`
        return { isValid: false, message }
      }
    }

    const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(existingBlocks, block.type)
    if (singleInstanceIssue) {
      const message = `A workflow can only have one ${singleInstanceIssue.blockName} block. ${action === 'paste' ? 'Please remove the existing one before pasting.' : 'Cannot duplicate.'}`
      return { isValid: false, message }
    }
  }
  return { isValid: true }
}

/**
 * Clears drag highlight classes and resets cursor state.
 * Used when drag operations end or are cancelled.
 */
export function clearDragHighlights(): void {
  document.querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over').forEach((el) => {
    el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
  })
  document.body.style.cursor = ''
}

interface BlockData {
  height?: number
  data?: {
    parentId?: string
    width?: number
    height?: number
  }
}

/**
 * Calculates the final position for a node, clamping it to parent container if needed.
 * Returns the clamped position suitable for persistence.
 */
export function getClampedPositionForNode(
  nodeId: string,
  nodePosition: { x: number; y: number },
  blocks: Record<string, BlockData>,
  allNodes: Node[]
): { x: number; y: number } {
  const currentBlock = blocks[nodeId]
  const currentParentId = currentBlock?.data?.parentId

  if (!currentParentId) {
    return nodePosition
  }

  const parentNode = allNodes.find((n) => n.id === currentParentId)
  if (!parentNode) {
    return nodePosition
  }

  const containerDimensions = {
    width: parentNode.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
    height: parentNode.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
  }
  const blockDimensions = {
    width: BLOCK_DIMENSIONS.FIXED_WIDTH,
    height: Math.max(
      currentBlock?.height || BLOCK_DIMENSIONS.MIN_HEIGHT,
      BLOCK_DIMENSIONS.MIN_HEIGHT
    ),
  }

  return clampPositionToContainer(nodePosition, containerDimensions, blockDimensions)
}

/**
 * Computes position updates for multiple nodes, clamping each to its parent container.
 * Used for batch position updates after multi-node drag or selection drag.
 */
export function computeClampedPositionUpdates(
  nodes: Node[],
  blocks: Record<string, BlockData>,
  allNodes: Node[]
): Array<{ id: string; position: { x: number; y: number } }> {
  return nodes.map((node) => ({
    id: node.id,
    position: getClampedPositionForNode(node.id, node.position, blocks, allNodes),
  }))
}

interface ParentUpdateEntry {
  blockId: string
  newParentId: string
  affectedEdges: Edge[]
}

/**
 * Computes parent update entries for nodes being moved into a subflow.
 * Only includes "boundary edges" - edges that cross the selection boundary
 * (one end inside selection, one end outside). Edges between nodes in the
 * selection are preserved.
 */
export function computeParentUpdateEntries(
  validNodes: Node[],
  allEdges: Edge[],
  targetParentId: string
): ParentUpdateEntry[] {
  const movingNodeIds = new Set(validNodes.map((n) => n.id))

  // Find edges that cross the boundary (one end inside selection, one end outside)
  // Edges between nodes in the selection should stay intact
  const boundaryEdges = allEdges.filter((e) => {
    const sourceInSelection = movingNodeIds.has(e.source)
    const targetInSelection = movingNodeIds.has(e.target)
    // Only remove if exactly one end is in the selection (crosses boundary)
    return sourceInSelection !== targetInSelection
  })

  // Build updates for all valid nodes
  return validNodes.map((n) => {
    // Only include boundary edges connected to this specific node
    const edgesForThisNode = boundaryEdges.filter((e) => e.source === n.id || e.target === n.id)
    return {
      blockId: n.id,
      newParentId: targetParentId,
      affectedEdges: edgesForThisNode,
    }
  })
}

/**
 * Resolves parent-child selection conflicts by deselecting children whose parent is also selected.
 */
export function resolveParentChildSelectionConflicts(
  nodes: Node[],
  blocks: Record<string, { data?: { parentId?: string } }>
): Node[] {
  const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id))

  let hasConflict = false
  const resolved = nodes.map((n) => {
    if (!n.selected) return n
    const parentId = n.parentId || blocks[n.id]?.data?.parentId
    if (parentId && selectedIds.has(parentId)) {
      hasConflict = true
      return { ...n, selected: false }
    }
    return n
  })

  return hasConflict ? resolved : nodes
}
