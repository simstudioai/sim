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
  description?: string
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
}

export interface BlockLayoutState {
  measuredWidth?: number
  measuredHeight?: number
}

/**
 * Inclusive bounds for {@link BlockRetryConfig.maxTries}: a retrying block tries
 * at least twice, since one retry is the whole point, and at most five times.
 */
export const BLOCK_RETRY_MIN_TRIES = 2
export const BLOCK_RETRY_MAX_TRIES = 5
export const BLOCK_RETRY_DEFAULT_TRIES = 3

/** Inclusive bounds for {@link BlockRetryConfig.waitBetweenTriesMs}. */
export const BLOCK_RETRY_MIN_WAIT_MS = 0
export const BLOCK_RETRY_MAX_WAIT_MS = 5_000
export const BLOCK_RETRY_DEFAULT_WAIT_MS = 1_000

/**
 * Opt-in per-block retry, off unless the builder turns it on.
 *
 * Retrying is only safe when the operation is idempotent, which the platform
 * cannot determine on a block's behalf: re-running "post message" or "create
 * ticket" after an ambiguous transport failure duplicates a real side effect.
 * The decision therefore belongs to whoever wired the block.
 *
 * The numbers persist independently of {@link BlockRetryConfig.enabled} so that
 * switching retry off and back on restores what was configured rather than
 * silently resetting to the defaults.
 */
export interface BlockRetryConfig {
  /** Absent config and `false` mean the same thing: the block runs once. */
  enabled: boolean
  /** Total tries including the first, clamped to the bounds above. */
  maxTries: number
  /** Delay between tries, clamped to the bounds above. */
  waitBetweenTriesMs: number
}

/**
 * Whether two stored policies mean the same thing.
 *
 * Compared field by field rather than by serializing: `retry` round-trips
 * through Postgres `jsonb`, which does not preserve key order, so a structural
 * compare would report a spurious change.
 */
export function blockRetryEquals(
  a: BlockRetryConfig | undefined,
  b: BlockRetryConfig | undefined
): boolean {
  if (!a || !b) return !a && !b
  return (
    a.enabled === b.enabled &&
    a.maxTries === b.maxTries &&
    a.waitBetweenTriesMs === b.waitBetweenTriesMs
  )
}

/**
 * Pins a tries count into range, falling back to the default when the value is
 * missing or unusable. Exported so the editor clamps exactly as execution does.
 *
 * Nullish is checked before the numeric conversion: `Number(null)` and
 * `Number('')` are both `0`, so coercing first would read a field that was never
 * set as an explicit zero.
 */
export function normalizeBlockRetryTries(value: unknown): number {
  return normalizeBound(
    value,
    BLOCK_RETRY_MIN_TRIES,
    BLOCK_RETRY_MAX_TRIES,
    BLOCK_RETRY_DEFAULT_TRIES
  )
}

/** Pins a wait into range. See {@link normalizeBlockRetryTries}. */
export function normalizeBlockRetryWaitMs(value: unknown): number {
  return normalizeBound(
    value,
    BLOCK_RETRY_MIN_WAIT_MS,
    BLOCK_RETRY_MAX_WAIT_MS,
    BLOCK_RETRY_DEFAULT_WAIT_MS
  )
}

function normalizeBound(value: unknown, min: number, max: number, fallback: number): number {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

/**
 * Normalizes a stored or wire-supplied retry policy into one the executor can
 * act on, or `null` when the block must not retry.
 *
 * Clamps rather than rejects: every reader — executor, editor, copilot,
 * imported YAML — goes through here, so a value that reached the database before
 * a bound moved still resolves to something runnable instead of failing the
 * whole workflow at serialization time.
 */
export function resolveBlockRetryConfig(
  retry: Partial<BlockRetryConfig> | null | undefined
): BlockRetryConfig | null {
  if (!retry?.enabled) return null

  return {
    enabled: true,
    maxTries: normalizeBlockRetryTries(retry.maxTries),
    waitBetweenTriesMs: normalizeBlockRetryWaitMs(retry.waitBetweenTriesMs),
  }
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
  /**
   * Opt-in retry policy. Absent — the default for every block that predates the
   * setting — means the block runs exactly once, as it always has.
   */
  retry?: BlockRetryConfig
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

/** The two card sides a connection line can attach to. Purely visual. */
export const WORKFLOW_CONNECTION_SIDES = ['left', 'right'] as const
export type WorkflowConnectionSide = (typeof WORKFLOW_CONNECTION_SIDES)[number]

/** The one output handle every non-branching block exposes. */
export const WORKFLOW_SOURCE_HANDLE_ID = 'source'
/** The one input handle every block that accepts a connection exposes. */
export const WORKFLOW_TARGET_HANDLE_ID = 'target'
/** The output handle a block's error branch leaves through. */
export const WORKFLOW_ERROR_HANDLE_ID = 'error'

/**
 * Side-anchored handle ids (`source-right`, `target-left`, …) briefly existed
 * as a second vocabulary for the ports these two ids already name. They are
 * recognized here so any edge persisted with one heals back to the canonical
 * id on read and on write; nothing mints them any more.
 */
const SIDE_ANCHORED_SOURCE_HANDLE_IDS = new Set<string>(
  WORKFLOW_CARD_SIDES.map((side) => `source-${side}`)
)
const SIDE_ANCHORED_TARGET_HANDLE_IDS = new Set<string>(
  WORKFLOW_CARD_SIDES.map((side) => `target-${side}`)
)

/**
 * Returns the canonical persisted source handle used for edge identity.
 *
 * Falsy-coalesce (not nullish-coalesce): persistence normalizes a missing
 * handle to `null` via `edge.sourceHandle || null` (see
 * apps/realtime/src/database/operations.ts), which also maps `''` to `null`.
 * Comparing with `??` would treat `''` and `null` as distinct handles
 * pre-insert while both are written as the same `null` value, letting a
 * `sourceHandle: ''` edge slip past the duplicate check.
 */
export function normalizeWorkflowEdgeSourceHandle(
  handle: string | null | undefined
): string | null {
  const canonical = handle || null
  if (canonical !== null && SIDE_ANCHORED_SOURCE_HANDLE_IDS.has(canonical)) {
    return WORKFLOW_SOURCE_HANDLE_ID
  }
  return canonical
}

/** Returns the canonical persisted target handle used for edge identity. */
export function normalizeWorkflowEdgeTargetHandle(
  handle: string | null | undefined
): string | null {
  const canonical = handle || null
  if (canonical !== null && SIDE_ANCHORED_TARGET_HANDLE_IDS.has(canonical)) {
    return WORKFLOW_TARGET_HANDLE_ID
  }
  return canonical
}

/**
 * Collects the ids of blocks an error edge leaves, canonicalizing handles first
 * so the set is the same however the edge list was loaded.
 */
export function collectErrorSourceBlockIds(
  edges: readonly WorkflowEdgeHandles[] | null | undefined
): Set<string> {
  const sources = new Set<string>()
  for (const edge of edges || []) {
    if (normalizeWorkflowEdgeSourceHandle(edge.sourceHandle) === WORKFLOW_ERROR_HANDLE_ID) {
      sources.add(edge.source)
    }
  }
  return sources
}

/**
 * Whether a block's error output is on, read from the edges as well as the flag.
 *
 * An error edge means the port is live whatever the flag says: `setBlockErrorEnabled`
 * leaves existing error edges in place, and both block renderers draw the port on
 * `errorEnabled || hasErrorConnection`, so a block can sit at `errorEnabled: false`
 * with a connected error edge indefinitely. The executor never reads the flag at
 * all — the edge alone decides routing — so the two spellings are one state.
 *
 * Every reader that compares or materializes a block must apply this rule rather
 * than the flag alone. Applying it on one side only is what pinned a workflow to
 * "needs redeploy" with nothing to deploy: change detection read a backfilled
 * `true` against a live `false`, and redeploying snapshotted the live `false` that
 * the next read backfilled straight back to `true`.
 */
export function resolveEffectiveErrorEnabled(
  block: Pick<BlockState, 'errorEnabled'>,
  blockId: string,
  errorSourceBlockIds: ReadonlySet<string>
): boolean {
  return Boolean(block.errorEnabled) || errorSourceBlockIds.has(blockId)
}

/**
 * Canonicalizes a whole edge list, for the readers that bypass
 * `loadWorkflowFromNormalizedTables` — deployment-version blobs, run
 * snapshots, and row-level copies. React Flow silently drops an edge whose
 * handle id matches no mounted handle, and change detection counts one as
 * both added and removed, so an un-healed list is invisible in the UI rather
 * than loud.
 *
 * Returns the original array when nothing needed changing, so callers can keep
 * memoizing on identity.
 */
export function normalizeWorkflowEdgeHandles<T extends WorkflowEdgeHandles>(
  edges: readonly T[] | null | undefined
): T[] {
  if (!edges?.length) return []

  let changed = false
  const normalized = edges.map((edge) => {
    const sourceHandle = normalizeWorkflowEdgeSourceHandle(edge.sourceHandle)
    const targetHandle = normalizeWorkflowEdgeTargetHandle(edge.targetHandle)
    if (sourceHandle === edge.sourceHandle && targetHandle === edge.targetHandle) return edge
    changed = true
    return { ...edge, sourceHandle, targetHandle }
  })

  return changed ? normalized : (edges as T[])
}

function isDuplicateWorkflowEdge(
  edge: WorkflowEdgeHandles,
  existing: WorkflowEdgeHandles
): boolean {
  return (
    edge.source === existing.source &&
    normalizeWorkflowEdgeSourceHandle(edge.sourceHandle) ===
      normalizeWorkflowEdgeSourceHandle(existing.sourceHandle) &&
    edge.target === existing.target &&
    normalizeWorkflowEdgeTargetHandle(edge.targetHandle) ===
      normalizeWorkflowEdgeTargetHandle(existing.targetHandle)
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
