import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS, getNoteBlockHeight } from '@sim/workflow-renderer'
import { isEqual } from 'es-toolkit'
import type { Edge, Node } from 'reactflow'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { clampPositionToContainer } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/node-position-utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

export const SUBFLOW_DROP_TARGET_CLASS = 'subflow-node-drop-target'

type ArrowNavigationEvent = Pick<
  KeyboardEvent,
  'key' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>

export function getArrowNavigationDirection(event: ArrowNavigationEvent): -1 | 1 | null {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return 1
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return -1
  return null
}

/**
 * A derivation that changed nothing must produce no new reference at any level,
 * so React Flow can skip the subtree. Reuse is decided by identity after
 * projection, which also catches a pure reorder: a reused item landing at a
 * different index breaks the positional sweep.
 */
function reconcileById<T extends { id: string }>(
  current: T[],
  derived: T[],
  project: (derivedItem: T, currentItem: T | undefined) => T,
  isReusable: (currentItem: T, nextItem: T) => boolean
): T[] {
  const currentById = new Map<string, T>()
  for (const item of current) currentById.set(item.id, item)

  const next = derived.map((derivedItem) => {
    const currentItem = currentById.get(derivedItem.id)
    const nextItem = project(derivedItem, currentItem)
    return currentItem && isReusable(currentItem, nextItem) ? currentItem : nextItem
  })

  const unchanged =
    next.length === current.length && next.every((item, index) => item === current[index])
  return unchanged ? current : next
}

/**
 * Subset comparison, deliberately asymmetric: React Flow writes `width`,
 * `height`, `positionAbsolute` and `dragging` onto the node objects it owns, so
 * a symmetric `isEqual` against a freshly derived node would never match and no
 * node would ever be reused. Only the keys the derivation itself produces are
 * compared.
 */
function containsDerivedValues<T extends object>(current: T, derived: T): boolean {
  for (const key of Object.keys(derived) as (keyof T)[]) {
    if (!isEqual(current[key], derived[key])) return false
  }
  return true
}

/** Reuses unchanged React Flow node objects while carrying local selection forward. */
export function reconcileCanvasNodes(currentNodes: Node[], derivedNodes: Node[]): Node[] {
  return reconcileById(
    currentNodes,
    derivedNodes,
    (derivedNode, currentNode) => ({ ...derivedNode, selected: currentNode?.selected ?? false }),
    containsDerivedValues
  )
}

/**
 * Reuses unchanged React Flow edge objects after graph-level derivation reruns.
 * Edges carry no React Flow-written fields, so a plain `isEqual` is symmetric-safe.
 */
export function reconcileCanvasEdges(currentEdges: Edge[], derivedEdges: Edge[]): Edge[] {
  return reconcileById(currentEdges, derivedEdges, (derivedEdge) => derivedEdge, isEqual)
}

/**
 * Collects all descendant block IDs for container blocks (loop/parallel) in the given set.
 * Used to treat a nested subflow as one unit when computing boundary edges (e.g. remove-from-subflow).
 *
 * @param blockIds - Root block IDs (e.g. the blocks being removed from subflow)
 * @param blocks - All workflow blocks
 * @returns IDs of blocks that are descendants of any container in blockIds (excluding the roots)
 */
export function getDescendantBlockIds(
  blockIds: string[],
  blocks: Record<string, BlockState>
): string[] {
  const current = new Set(blockIds)
  const added: string[] = []
  const toProcess = [...blockIds]

  while (toProcess.length > 0) {
    const id = toProcess.pop()!
    const block = blocks[id]
    if (block?.type !== 'loop' && block?.type !== 'parallel') continue

    for (const [bid, b] of Object.entries(blocks)) {
      if (b?.data?.parentId === id && !current.has(bid)) {
        current.add(bid)
        added.push(bid)
        toProcess.push(bid)
      }
    }
  }

  return added
}

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
 * Determines whether a block should be treated as a positional trigger — a workflow
 * entry point inferred from having no incoming edges.
 *
 * Blocks nested inside a loop or parallel subflow are never triggers regardless of
 * their edges: a block pasted into a subflow starts with no incoming edges but is
 * still an ordinary nested block (e.g. it must keep its "Remove from Subflow" action).
 *
 * @param block - The block to classify (id plus its parent binding, if any)
 * @param edges - All workflow edges
 * @returns True if the block is a top-level block with no incoming edges
 */
export function isPositionalTriggerBlock(
  block: { id: string; parentId?: string } | undefined,
  edges: Array<Pick<Edge, 'target'>>
): boolean {
  if (!block || block.parentId) return false
  return !edges.some((edge) => edge.target === block.id)
}

/**
 * Returns whether a container should be emphasized as a new drop target.
 * Moving within the block's existing container is a position change, not a
 * re-parent operation, so it must not activate the container highlight.
 */
export function shouldHighlightContainerDropTarget(
  currentParentId: string | null | undefined,
  targetContainerId: string
): boolean {
  return currentParentId !== targetContainerId
}

/**
 * Clears drag highlight classes and resets cursor state.
 * Used when drag operations end or are cancelled.
 */
export function clearDragHighlights(): void {
  document.querySelectorAll(`.${SUBFLOW_DROP_TARGET_CLASS}`).forEach((el) => {
    el.classList.remove(SUBFLOW_DROP_TARGET_CLASS)
  })
  document.body.style.cursor = ''
}

interface BlockData {
  type?: string
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
    width:
      currentBlock?.type === 'note' ? BLOCK_DIMENSIONS.NOTE_WIDTH : BLOCK_DIMENSIONS.FIXED_WIDTH,
    height:
      currentBlock?.type === 'note'
        ? currentBlock.height || getNoteBlockHeight(true)
        : Math.max(
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

export function getNodeSelectionContextId(
  node: Pick<Node, 'id' | 'parentId'>,
  blocks: Record<string, { data?: { parentId?: string } }>
): string | null {
  return node.parentId || blocks[node.id]?.data?.parentId || null
}

export function getEdgeSelectionContextId(
  edge: Pick<Edge, 'source' | 'target'>,
  nodes: Array<Pick<Node, 'id' | 'parentId'>>,
  blocks: Record<string, { data?: { parentId?: string } }>
): string | null {
  const sourceNode = nodes.find((node) => node.id === edge.source)
  const targetNode = nodes.find((node) => node.id === edge.target)
  const sourceContextId = sourceNode ? getNodeSelectionContextId(sourceNode, blocks) : null
  const targetContextId = targetNode ? getNodeSelectionContextId(targetNode, blocks) : null
  if (sourceContextId) return sourceContextId
  if (targetContextId) return targetContextId
  return null
}

export function resolveSelectionContextConflicts(
  nodes: Node[],
  blocks: Record<string, { data?: { parentId?: string } }>,
  preferredContextId?: string | null
): Node[] {
  const selectedNodes = nodes.filter((node) => node.selected)
  if (selectedNodes.length <= 1) return nodes

  const allowedContextId =
    preferredContextId !== undefined
      ? preferredContextId
      : getNodeSelectionContextId(selectedNodes[0], blocks)
  let hasConflict = false

  const resolved = nodes.map((node) => {
    if (!node.selected) return node
    const contextId = getNodeSelectionContextId(node, blocks)
    if (contextId !== allowedContextId) {
      hasConflict = true
      return { ...node, selected: false }
    }
    return node
  })

  return hasConflict ? resolved : nodes
}

export function resolveSelectionConflicts(
  nodes: Node[],
  blocks: Record<string, { data?: { parentId?: string } }>,
  preferredNodeId?: string
): Node[] {
  const afterParentChild = resolveParentChildSelectionConflicts(nodes, blocks)

  const preferredContextId =
    preferredNodeId !== undefined
      ? afterParentChild.find((n) => n.id === preferredNodeId && n.selected)
        ? getNodeSelectionContextId(afterParentChild.find((n) => n.id === preferredNodeId)!, blocks)
        : undefined
      : undefined

  return resolveSelectionContextConflicts(afterParentChild, blocks, preferredContextId)
}
