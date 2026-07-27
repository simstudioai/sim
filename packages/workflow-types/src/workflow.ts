import type { Edge } from 'reactflow'
import type { OutputFieldDefinition, SubBlockType } from './blocks'

export const SUBFLOW_TYPES = {
  LOOP: 'loop',
  PARALLEL: 'parallel',
} as const

export type SubflowType = (typeof SUBFLOW_TYPES)[keyof typeof SUBFLOW_TYPES]

export function isValidSubflowType(type: string): type is SubflowType {
  return Object.values(SUBFLOW_TYPES).includes(type as SubflowType)
}

export interface LoopConfig {
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: unknown[] | Record<string, unknown> | string
  whileCondition?: string
  doWhileCondition?: string
}

export interface ParallelConfig {
  nodes: string[]
  distribution?: unknown[] | Record<string, unknown> | string
  parallelType?: 'count' | 'collection'
  batchSize?: number
}

export interface Subflow {
  id: string
  workflowId: string
  type: SubflowType
  config: LoopConfig | ParallelConfig
  createdAt: Date
  updatedAt: Date
}

export interface Position {
  x: number
  y: number
}

export interface BlockData {
  parentId?: string
  extent?: 'parent'
  width?: number
  height?: number
  collection?: any
  count?: number
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  whileCondition?: string
  doWhileCondition?: string
  parallelType?: 'collection' | 'count'
  batchSize?: number
  type?: string
  canonicalModes?: Record<string, 'basic' | 'advanced'>
  /** Persisted mirror of {@link BlockState.errorEnabled}. */
  errorEnabled?: boolean
}

export interface BlockLayoutState {
  measuredWidth?: number
  measuredHeight?: number
}

export interface BlockState {
  id: string
  type: string
  name: string
  position: Position
  subBlocks: Record<string, SubBlockState>
  outputs: Record<string, OutputFieldDefinition>
  enabled: boolean
  horizontalHandles?: boolean
  /**
   * Whether this block exposes its error output. Drives the red error port;
   * the error row itself is always shown for blocks that support one. Off by
   * default.
   */
  errorEnabled?: boolean
  height?: number
  advancedMode?: boolean
  triggerMode?: boolean
  data?: BlockData
  layout?: BlockLayoutState
  locked?: boolean
}

export interface WorkflowLockBlock {
  locked?: boolean | null
  data?: unknown
}

/**
 * Reads a workflow block's parent ID from runtime block data.
 */
export function getWorkflowBlockParentId(block?: WorkflowLockBlock): string | undefined {
  const data = block?.data
  if (typeof data !== 'object' || data === null || !('parentId' in data)) return undefined

  const parentId = (data as Record<string, unknown>).parentId
  return typeof parentId === 'string' && parentId.length > 0 ? parentId : undefined
}

/**
 * Checks whether any parent container in a block's ancestry is locked.
 */
export function isWorkflowBlockAncestorLocked(
  blockId: string,
  blocks: Record<string, WorkflowLockBlock>
): boolean {
  const visited = new Set<string>()
  let parentId = getWorkflowBlockParentId(blocks[blockId])

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = blocks[parentId]
    if (!parent) return false
    if (parent.locked) return true
    parentId = getWorkflowBlockParentId(parent)
  }

  return false
}

/**
 * Checks whether a block is locked directly or protected by a locked ancestor.
 */
export function isWorkflowBlockProtected(
  blockId: string,
  blocks: Record<string, WorkflowLockBlock>
): boolean {
  const block = blocks[blockId]
  if (!block) return false
  return Boolean(block.locked || isWorkflowBlockAncestorLocked(blockId, blocks))
}

export interface WorkflowEdgeEndpoints {
  source: string
  target: string
}

/**
 * Checks whether adding an edge would create a cycle in the graph, via DFS
 * reachability from the proposed target back to the proposed source.
 *
 * Shared between the client store, the collaborative queueing layer, and the
 * realtime persistence layer so all three agree on the same cyclic edges —
 * an edge rejected by one must never be accepted (and persisted) by another.
 */
export function wouldCreateCycle(
  edges: WorkflowEdgeEndpoints[],
  sourceId: string,
  targetId: string
): boolean {
  if (sourceId === targetId) {
    return true
  }

  const adjacencyList = new Map<string, string[]>()
  for (const edge of edges) {
    if (!adjacencyList.has(edge.source)) {
      adjacencyList.set(edge.source, [])
    }
    adjacencyList.get(edge.source)!.push(edge.target)
  }

  const visited = new Set<string>()

  function canReachSource(currentNode: string): boolean {
    if (currentNode === sourceId) {
      return true
    }

    if (visited.has(currentNode)) {
      return false
    }

    visited.add(currentNode)

    const neighbors = adjacencyList.get(currentNode) || []
    for (const neighbor of neighbors) {
      if (canReachSource(neighbor)) {
        return true
      }
    }

    return false
  }

  return canReachSource(targetId)
}

/**
 * Filters a batch of candidate edges down to the ones that do not create a
 * cycle, evaluated incrementally so edges within the same batch that would
 * chain into a cycle are also rejected.
 */
export function filterAcyclicEdges<T extends WorkflowEdgeEndpoints>(
  edgesToAdd: T[],
  currentEdges: WorkflowEdgeEndpoints[]
): T[] {
  const workingEdges: WorkflowEdgeEndpoints[] = [...currentEdges]
  const acyclicEdges: T[] = []

  for (const edge of edgesToAdd) {
    if (wouldCreateCycle(workingEdges, edge.source, edge.target)) continue
    workingEdges.push(edge)
    acyclicEdges.push(edge)
  }

  return acyclicEdges
}

/** Edge endpoints that also identify the specific handle used on each side. */
export interface WorkflowEdgeHandles extends WorkflowEdgeEndpoints {
  sourceHandle?: string | null
  targetHandle?: string | null
}

export const WORKFLOW_CARD_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type WorkflowCardSide = (typeof WORKFLOW_CARD_SIDES)[number]

export const POSITIONED_SOURCE_HANDLE_SIDES = ['left', 'right'] as const
export type PositionedSourceHandleSide = (typeof POSITIONED_SOURCE_HANDLE_SIDES)[number]
export type PositionedSourceHandleId = `source-${PositionedSourceHandleSide}`
type LegacyPositionedSourceHandleId = `source-${WorkflowCardSide}`

const POSITIONED_SOURCE_HANDLE_IDS = new Set<string>(
  WORKFLOW_CARD_SIDES.map((side) => `source-${side}`)
)

/** Returns the persistent source-handle ID for a card side. */
export function getPositionedSourceHandleId(
  side: PositionedSourceHandleSide
): PositionedSourceHandleId {
  return `source-${side}`
}

/** Identifies source handles that encode a visual card side. */
export function isPositionedSourceHandle(
  handle: string | null | undefined
): handle is LegacyPositionedSourceHandleId {
  return typeof handle === 'string' && POSITIONED_SOURCE_HANDLE_IDS.has(handle)
}

export type PositionedTargetHandleId = `target-${PositionedSourceHandleSide}`
type LegacyPositionedTargetHandleId = `target-${WorkflowCardSide}`

const POSITIONED_TARGET_HANDLE_IDS = new Set<string>(
  WORKFLOW_CARD_SIDES.map((side) => `target-${side}`)
)

/** Returns the persistent target-handle ID for a card side. */
export function getPositionedTargetHandleId(
  side: PositionedSourceHandleSide
): PositionedTargetHandleId {
  return `target-${side}`
}

/** Identifies target handles that encode a visual card side. */
export function isPositionedTargetHandle(
  handle: string | null | undefined
): handle is LegacyPositionedTargetHandleId {
  return typeof handle === 'string' && POSITIONED_TARGET_HANDLE_IDS.has(handle)
}

/** Returns the card side encoded by a positioned source handle. */
export function getPositionedSourceHandleSide(
  handle: string | null | undefined
): PositionedSourceHandleSide | null {
  if (!isPositionedSourceHandle(handle)) return null
  return handle === 'source-left' ? 'left' : 'right'
}

/**
 * Collapses every non-right source anchor onto the canonical right-side anchor.
 *
 * Outputs leave a card from the right, always. Left is the input side, so an
 * output anchored there would draw an outgoing line out of the input port and
 * read as a second input. Legacy vertical anchors collapse for the same reason:
 * top and bottom are not connection sides.
 */
export function normalizePositionedSourceHandleId<T extends string | null | undefined>(
  handle: T
): T | PositionedSourceHandleId {
  return handle === 'source-top' || handle === 'source-bottom' || handle === 'source-left'
    ? getPositionedSourceHandleId('right')
    : handle
}

/** Collapses legacy vertical target anchors onto the canonical left-side anchor. */
export function normalizePositionedTargetHandleId<T extends string | null | undefined>(
  handle: T
): T | PositionedTargetHandleId {
  return handle === 'target-top' || handle === 'target-bottom'
    ? getPositionedTargetHandleId('left')
    : handle
}

/** Resolves a top/bottom pointer into the card's left or right connection half. */
export function getHorizontalWorkflowHandleSide(
  pointerX: number,
  cardWidth: number
): PositionedSourceHandleSide {
  if (!Number.isFinite(pointerX) || !Number.isFinite(cardWidth) || cardWidth <= 0) return 'right'
  return pointerX < cardWidth / 2 ? 'left' : 'right'
}

// Falsy-coalesce (not nullish-coalesce): persistence normalizes a missing
// handle to `null` via `edge.sourceHandle || null` (see
// apps/realtime/src/database/operations.ts), which also maps `''` to
// `null`. Comparing with `??` would treat `''` and `null` as distinct
// handles pre-insert while both are written as the same `null` value,
// letting a `sourceHandle: ''` edge slip past the duplicate check.
function normalizeWorkflowEdgeHandle(handle: string | null | undefined): string | null {
  return handle || null
}

function isDuplicateWorkflowEdge(
  edge: WorkflowEdgeHandles,
  existing: WorkflowEdgeHandles
): boolean {
  return (
    edge.source === existing.source &&
    normalizeWorkflowEdgeHandle(edge.sourceHandle) ===
      normalizeWorkflowEdgeHandle(existing.sourceHandle) &&
    edge.target === existing.target &&
    normalizeWorkflowEdgeHandle(edge.targetHandle) ===
      normalizeWorkflowEdgeHandle(existing.targetHandle)
  )
}

/**
 * Filters a batch of candidate edges down to the ones that are not
 * self-loops and do not duplicate an edge already present (same source,
 * target, and handles), evaluated incrementally so two duplicate edges
 * within the same batch are also caught (only the first survives). Shared
 * between the client store, the collaborative queueing layer, and the
 * realtime persistence layer.
 */
export function filterUniqueWorkflowEdges<T extends WorkflowEdgeHandles>(
  edgesToAdd: T[],
  currentEdges: WorkflowEdgeHandles[]
): T[] {
  const workingEdges: WorkflowEdgeHandles[] = [...currentEdges]
  const uniqueEdges: T[] = []

  for (const edge of edgesToAdd) {
    if (edge.source === edge.target) continue
    if (workingEdges.some((existing) => isDuplicateWorkflowEdge(edge, existing))) continue
    workingEdges.push(edge)
    uniqueEdges.push(edge)
  }

  return uniqueEdges
}

const WORKFLOW_CONTAINER_BLOCK_TYPES = new Set(['loop', 'parallel'])
const WORKFLOW_ANNOTATION_ONLY_BLOCK_TYPE = 'note'
/** Legacy trigger block type — see TRIGGER_TYPES.STARTER in apps/sim/lib/workflows/triggers/triggers.ts. */
const LEGACY_STARTER_BLOCK_TYPE = 'starter'

export interface WorkflowEdgeScopeBlock extends WorkflowLockBlock {
  type?: string
}

/**
 * Checks whether an edge crosses loop/parallel scope boundaries — an edge is
 * only valid within the same container, or between a container and its
 * direct parent/child.
 */
export function getWorkflowEdgeScopeDropReason(
  edge: WorkflowEdgeEndpoints,
  blocks: Record<string, WorkflowEdgeScopeBlock>
): string | null {
  const sourceBlock = blocks[edge.source]
  const targetBlock = blocks[edge.target]

  if (!sourceBlock || !targetBlock) {
    return 'edge references a missing block'
  }

  const sourceParent = getWorkflowBlockParentId(sourceBlock) ?? null
  const targetParent = getWorkflowBlockParentId(targetBlock) ?? null

  if (sourceParent === targetParent) {
    return null
  }

  if (targetParent === edge.source && WORKFLOW_CONTAINER_BLOCK_TYPES.has(sourceBlock.type ?? '')) {
    return null
  }

  if (sourceParent === edge.target && WORKFLOW_CONTAINER_BLOCK_TYPES.has(targetBlock.type ?? '')) {
    return null
  }

  return `blocks are in different scopes (${sourceParent ?? 'root'} -> ${targetParent ?? 'root'})`
}

/** True when a block's type is the annotation-only "note" block, which cannot participate in edges. */
export function isWorkflowAnnotationOnlyBlockType(blockType: string | undefined): boolean {
  return blockType === WORKFLOW_ANNOTATION_ONLY_BLOCK_TYPE
}

export interface WorkflowTriggerCapableBlock {
  type?: string
  triggerMode?: boolean
}

/**
 * Portable subset of trigger-block detection: an explicit `triggerMode`
 * toggle, or the legacy starter block type. Does NOT cover blocks whose
 * trigger status comes from the block registry's `category: 'triggers'`
 * field (most modern trigger blocks) — that classification only exists in
 * the client's block registry (apps/sim/blocks), which apps/realtime is
 * architecturally forbidden from importing (see
 * scripts/check-monorepo-boundaries.ts). Persisting a redundant "isTrigger"
 * flag on the block row to cover that case would itself be a driftable
 * duplicate, so that case remains client-enforced only; see
 * TriggerUtils.isTriggerBlock in apps/sim/lib/workflows/triggers/triggers.ts
 * for the full (client-only) check.
 */
export function isKnownWorkflowTriggerBlock(block: WorkflowTriggerCapableBlock): boolean {
  return block.triggerMode === true || block.type === LEGACY_STARTER_BLOCK_TYPE
}

/**
 * Names reserved for reference-path prefixes (`<loop.index>`, `<parallel.currentItem>`,
 * `<variable.x>`) — a block cannot take one of these as its (normalized) name.
 */
export const RESERVED_WORKFLOW_BLOCK_NAMES = ['loop', 'parallel', 'variable'] as const

/**
 * Normalizes a block name into its reference-safe form: lowercased, whitespace
 * stripped, dots stripped. Dots are stripped because `.` is the reference path
 * delimiter — a name like "Trigger.dev 1" must normalize to "triggerdev1" so
 * the reference `<triggerdev1.output>` parses unambiguously.
 */
export function normalizeWorkflowBlockName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/\./g, '')
}

export interface WorkflowBlockNameConflict {
  reason: 'empty' | 'reserved' | 'duplicate'
  conflictingBlockId?: string
}

/**
 * Checks whether renaming `blockId` to `name` would produce an empty name, a
 * reserved name, or collide with another block's normalized name. Block names
 * are used as `<blockName.field>` reference identifiers, so two blocks landing
 * on the same normalized name makes reference resolution ambiguous — shared
 * between the client store and the realtime persistence layer so both agree
 * on the same conflicts.
 */
export function getWorkflowBlockNameConflict(
  blockId: string,
  name: string,
  siblingNamesById: Record<string, string>
): WorkflowBlockNameConflict | null {
  const normalized = normalizeWorkflowBlockName(name)
  if (!normalized) return { reason: 'empty' }

  const conflict = Object.entries(siblingNamesById).find(
    ([id, siblingName]) => id !== blockId && normalizeWorkflowBlockName(siblingName) === normalized
  )
  if (conflict) return { reason: 'duplicate', conflictingBlockId: conflict[0] }

  if ((RESERVED_WORKFLOW_BLOCK_NAMES as readonly string[]).includes(normalized)) {
    return { reason: 'reserved' }
  }

  return null
}

export interface SubBlockState {
  id: string
  type: SubBlockType
  value: string | number | string[][] | null
}

export interface LoopBlock {
  id: string
  loopType: 'for' | 'forEach'
  count: number
  collection: string
  width: number
  height: number
  executionState: {
    isExecuting: boolean
    startTime: null | number
    endTime: null | number
  }
}

export interface ParallelBlock {
  id: string
  collection: string
  width: number
  height: number
  executionState: {
    currentExecution: number
    isExecuting: boolean
    startTime: null | number
    endTime: null | number
  }
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: any[] | Record<string, any> | string
  whileCondition?: string
  doWhileCondition?: string
  enabled: boolean
  locked?: boolean
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string
  count?: number
  parallelType?: 'count' | 'collection'
  batchSize?: number
  enabled: boolean
  locked?: boolean
}

export interface Variable {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
  value: unknown
}

export interface DragStartPosition {
  id: string
  x: number
  y: number
  parentId?: string | null
}

export interface WorkflowState {
  currentWorkflowId?: string | null
  blocks: Record<string, BlockState>
  edges: Edge[]
  lastSaved?: number
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastUpdate?: number
  metadata?: {
    name?: string
    description?: string
    exportedAt?: string
  }
  variables?: Record<string, Variable>
  dragStartPosition?: DragStartPosition | null
}
