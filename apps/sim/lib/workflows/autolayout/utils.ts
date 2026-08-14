import {
  BLOCK_DIMENSIONS,
  CONTAINER_DIMENSIONS,
  clampNoteBlockTotalHeight,
  getNoteBlockHeight,
  isNoteContentEmpty,
} from '@sim/workflow-renderer'
import {
  AUTO_LAYOUT_EXCLUDED_TYPES,
  CONTAINER_BLOCK_TYPES,
  CONTAINER_PADDING,
  CONTAINER_PADDING_X,
  CONTAINER_PADDING_Y,
  NOTE_BLOCK_TYPE,
  ROOT_PADDING_X,
  ROOT_PADDING_Y,
} from '@/lib/workflows/autolayout/constants'
import type { BlockMetrics, BoundingBox, Edge, GraphNode } from '@/lib/workflows/autolayout/types'
import { showsCanvasErrorRow } from '@/lib/workflows/blocks/canvas-rows'
import {
  type CardSelector,
  estimateSentenceLines,
  getOperationSubBlockId,
  resolveCanvasSentence,
} from '@/lib/workflows/blocks/canvas-sentence'
import { resolveSelectedTriggerId } from '@/lib/workflows/blocks/canvas-trigger-sentence'
import { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'
import { getConditionRows, getRouterRows } from '@/lib/workflows/dynamic-handle-topology'
import { getDisplayValue, hasDisplayableRowValue } from '@/lib/workflows/subblocks/display'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isSubBlockFeatureEnabled,
  isSubBlockHidden,
  isSubBlockVisibleForMode,
  isToolInputOnlySubBlock,
  isTriggerModeSubBlock,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

/**
 * Resolves a potentially undefined numeric value to a fallback
 */
function resolveNumeric(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Snaps a single coordinate value to the nearest grid position
 */
function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

/**
 * Snaps a position to the nearest grid point.
 * Returns the original position if gridSize is 0 or not provided.
 */
export function snapPositionToGrid(
  position: { x: number; y: number },
  gridSize: number | undefined
): { x: number; y: number } {
  if (!gridSize || gridSize <= 0) {
    return position
  }
  return {
    x: snapToGrid(position.x, gridSize),
    y: snapToGrid(position.y, gridSize),
  }
}

/**
 * Snaps all node positions in a graph to grid positions and returns updated dimensions.
 * Returns null if gridSize is not set or no snapping was needed.
 */
export function snapNodesToGrid(
  nodes: Map<string, GraphNode>,
  gridSize: number | undefined
): { width: number; height: number } | null {
  if (!gridSize || gridSize <= 0 || nodes.size === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes.values()) {
    node.position = snapPositionToGrid(node.position, gridSize)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.metrics.width)
    maxY = Math.max(maxY, node.position.y + node.metrics.height)
  }

  return {
    width: maxX - minX + CONTAINER_PADDING * 2,
    height: maxY - minY + CONTAINER_PADDING * 2,
  }
}

/**
 * Checks if a block type is a container (loop or parallel)
 */
export function isContainerType(blockType: string): boolean {
  return CONTAINER_BLOCK_TYPES.has(blockType)
}

/**
 * Checks if a block should be excluded from autolayout
 */
export function shouldSkipAutoLayout(block?: BlockState): boolean {
  if (!block) return true
  return AUTO_LAYOUT_EXCLUDED_TYPES.has(block.type)
}

/**
 * Filters block IDs to only include those eligible for layout
 */
export function filterLayoutEligibleBlockIds(
  blockIds: string[],
  blocks: Record<string, BlockState>
): string[] {
  return blockIds.filter((id) => {
    const block = blocks[id]
    if (!block) return false
    return !shouldSkipAutoLayout(block)
  })
}

/**
 * Gets metrics for a container block
 */
function getContainerMetrics(block: BlockState): BlockMetrics {
  const measuredWidth = block.layout?.measuredWidth
  const measuredHeight = block.layout?.measuredHeight

  const containerWidth = Math.max(
    measuredWidth ?? 0,
    resolveNumeric(block.data?.width, CONTAINER_DIMENSIONS.DEFAULT_WIDTH)
  )
  const containerHeight = Math.max(
    measuredHeight ?? 0,
    resolveNumeric(block.data?.height, CONTAINER_DIMENSIONS.DEFAULT_HEIGHT)
  )

  return {
    width: containerWidth,
    height: containerHeight,
    /* A container is sized by its stored width/height, so what it paints and
       what it reserves are the same number. Its ports do not depend on either
       — they sit a fixed inset below the header, on the Start card's centre. */
    portHeight: containerHeight,
    minWidth: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
    minHeight: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    paddingTop: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingBottom: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingLeft: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingRight: BLOCK_DIMENSIONS.HEADER_HEIGHT,
  }
}

/**
 * Resolves the subblocks a collapsed card renders, using the same visibility
 * rules as the canvas block, for use when no DOM measurement exists yet.
 *
 * `fallbackCount` covers the block types with no registry config, where the
 * only signal available is how many subblock values the block carries.
 */
function getVisiblePreviewSubBlocks(block: BlockState): {
  visibleSubBlocks: SubBlockConfig[]
  fallbackCount: number
  rawValues: Record<string, unknown>
} {
  const blockConfig = getBlock(block.type)
  if (!blockConfig?.subBlocks?.length) {
    return {
      visibleSubBlocks: [],
      fallbackCount: Object.values(block.subBlocks || {}).filter((subBlock) => subBlock != null)
        .length,
      rawValues: {},
    }
  }

  const rawValues = buildSubBlockValues(block.subBlocks || {})
  const canonicalModeOverrides =
    typeof block.data?.canonicalModes === 'object' && block.data.canonicalModes !== null
      ? (block.data.canonicalModes as CanonicalModeOverrides)
      : undefined

  if (canonicalModeOverrides) {
    rawValues.__canonicalModes = canonicalModeOverrides
  }

  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
  const effectiveAdvanced = Boolean(block.advancedMode)
  const effectiveTrigger = Boolean(block.triggerMode)
  const isPureTriggerBlock = blockConfig.triggers?.enabled && blockConfig.category === 'triggers'

  const visibleSubBlocks = blockConfig.subBlocks.filter((subBlock) => {
    if (subBlock.hidden || subBlock.hideFromPreview) return false
    if (!isSubBlockFeatureEnabled(subBlock)) return false
    // Never rendered on the canvas, so it must not contribute to node height —
    // this filter has to agree with `workflow-block.tsx`'s or blocks lay out
    // with a phantom row of space.
    if (isToolInputOnlySubBlock(subBlock)) return false
    if (isSubBlockHidden(subBlock)) return false

    if (effectiveTrigger) {
      const isValidTriggerSubblock = isPureTriggerBlock
        ? isTriggerModeSubBlock(subBlock) || !subBlock.mode
        : isTriggerModeSubBlock(subBlock)

      if (!isValidTriggerSubblock) {
        return false
      }
    } else if (isTriggerModeSubBlock(subBlock)) {
      return false
    }

    if (
      !isSubBlockVisibleForMode(
        subBlock,
        effectiveAdvanced,
        canonicalIndex,
        rawValues,
        canonicalModeOverrides
      )
    ) {
      return false
    }

    if (!subBlock.condition) return true
    return evaluateSubBlockCondition(subBlock.condition, rawValues)
  })

  return { visibleSubBlocks, fallbackCount: visibleSubBlocks.length, rawValues }
}

/**
 * Estimates the wrapped line count of a block's summary sentence, or 0 when it
 * declares none for this state.
 *
 * The renderer shows a value chip for a field that is visible *and* holds a
 * displayable value, and a noun chip for a core slot that is merely visible, so
 * both predicates are passed here. That makes this the one part of the estimate
 * that reproduces the card exactly rather than over-counting — a sentence
 * replaces every field row, so guessing high here would reserve a card's worth
 * of empty space under every sentenced block.
 *
 * Returns 0 in trigger mode, matching the renderer: a sentence describes the
 * block's action, which a card in trigger mode does not run.
 */
function estimateSentenceLineCount(
  block: BlockState,
  visibleSubBlocks: SubBlockConfig[],
  rawValues: Record<string, unknown>
): number {
  const blockConfig = getBlock(block.type)
  if (!blockConfig?.canvasPresentation?.sentences) return 0

  const availableIds = new Set<string>()
  const onCardById = new Map<string, SubBlockConfig>()
  for (const subBlock of visibleSubBlocks) {
    if (!onCardById.has(subBlock.id)) onCardById.set(subBlock.id, subBlock)
    if (hasDisplayableRowValue(subBlock, rawValues[subBlock.id])) availableIds.add(subBlock.id)
  }

  const operationSubBlockId = getOperationSubBlockId(blockConfig)
  const card: CardSelector = block.triggerMode
    ? (() => {
        const triggerId = resolveSelectedTriggerId(blockConfig, rawValues)
        return {
          mode: 'trigger' as const,
          triggerId,
          triggerName: triggerId ? (TRIGGER_REGISTRY[triggerId]?.name ?? null) : null,
        }
      })()
    : {
        mode: 'action',
        operationValue: operationSubBlockId ? rawValues[operationSubBlockId] : undefined,
      }

  const segments = resolveCanvasSentence(
    blockConfig,
    card,
    (subBlockId) => availableIds.has(subBlockId),
    (subBlockId) => onCardById.get(subBlockId) ?? null
  )
  if (!segments) return 0

  return estimateSentenceLines(
    segments,
    (subBlockId) => getDisplayValue(rawValues[subBlockId]),
    BLOCK_DIMENSIONS.FIXED_WIDTH - BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING
  )
}

/**
 * Estimates a block's card height for auto-layout.
 *
 * Only reached for a block that has never mounted — copilot output, an import,
 * or a server-side layout run. Anything the user has seen publishes its exact
 * height instead, and `getRegularBlockMetrics` takes the larger of the two.
 *
 * Deliberately biased to over-estimate on the field-row path, where
 * `mcp-dynamic-args` expands into one row per argument and cannot be
 * reproduced from block state. Counting every config-visible field — including
 * the empty ones the card omits — is the slack that keeps it from landing
 * short. An over-estimate opens a gap under a card; an under-estimate overlaps
 * it with the next one, so the bias only ever errs the cosmetic way.
 *
 * A block that declares a summary sentence is exact instead: the sentence
 * replaces every field row, so the row-count slack would reserve a whole card
 * of empty space beneath it.
 */
function estimateWorkflowBlockDimensions(block: BlockState): { width: number; height: number } {
  const blockConfig = getBlock(block.type)
  const { visibleSubBlocks, fallbackCount, rawValues } = getVisiblePreviewSubBlocks(block)

  if (!blockConfig) {
    return {
      width: BLOCK_DIMENSIONS.FIXED_WIDTH,
      height: Math.max(
        BLOCK_DIMENSIONS.HEADER_HEIGHT +
          BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
          fallbackCount * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT,
        BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT
      ),
    }
  }

  const sentenceLineCount = estimateSentenceLineCount(block, visibleSubBlocks, rawValues)

  return calculateWorkflowBlockDimensions({
    blockType: block.type,
    /* A sentence replaces the rows entirely, so counting both would stack the
       two layouts on top of each other. */
    visibleSubBlockCount: sentenceLineCount > 0 ? 0 : visibleSubBlocks.length,
    sentenceLineCount,
    /* The one input the branch left out. Every block that can emit an error
       carries the row permanently, so omitting it under-counted 32px on
       almost every card — the one direction that causes overlaps. */
    hasErrorRow: showsCanvasErrorRow(blockConfig, block.type, Boolean(block.triggerMode)),
    conditionRowCount:
      block.type === 'condition'
        ? getConditionRows(block.id, block.subBlocks?.conditions?.value).length
        : 0,
    routerRowCount:
      block.type === 'router_v2'
        ? getRouterRows(block.id, block.subBlocks?.routes?.value).length
        : 0,
  })
}

/**
 * Gets metrics for a regular (non-container) block.
 * Falls back to subblock-based height estimation when no measurement exists,
 * which prevents overlaps for newly added blocks that haven't been rendered.
 */
function getRegularBlockMetrics(block: BlockState): BlockMetrics {
  const minWidth = BLOCK_DIMENSIONS.FIXED_WIDTH
  const minHeight = BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT
  const measuredH = block.layout?.measuredHeight ?? block.height
  const measuredW = block.layout?.measuredWidth
  const estimatedDimensions = estimateWorkflowBlockDimensions(block)

  /*
   * Spacing height keeps the max of both signals: a stored measurement can be
   * stale (the block's content changed and it has not re-rendered — the
   * `resizedBlockIds` path exists for exactly that), while the estimate is all
   * there is for a block that has never mounted. Biasing tall is deliberate —
   * an over-estimate leaves a gap, an under-estimate overlaps two cards.
   *
   * Port height takes the measurement alone whenever there is one, because it
   * is exactly what the card paints and ports are centred on it. Feeding the
   * padded spacing height into that centring would tilt every edge by half the
   * padding.
   */
  const hasMeasurement = typeof measuredH === 'number' && measuredH > 0
  const height = hasMeasurement
    ? Math.max(measuredH, estimatedDimensions.height, minHeight)
    : Math.max(estimatedDimensions.height, minHeight)
  const portHeight = Math.max(
    hasMeasurement ? measuredH : estimatedDimensions.height,
    BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT
  )
  const width = Math.max(measuredW ?? estimatedDimensions.width, minWidth)

  return {
    width,
    height,
    portHeight,
    minWidth,
    minHeight,
    paddingTop: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingBottom: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingLeft: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingRight: BLOCK_DIMENSIONS.HEADER_HEIGHT,
  }
}

/**
 * Gets the dimensions and metrics for a block
 */
export function getBlockMetrics(block: BlockState): BlockMetrics {
  if (isContainerType(block.type)) {
    return getContainerMetrics(block)
  }

  return getRegularBlockMetrics(block)
}

/**
 * Prepares metrics for all nodes in a graph
 */
export function prepareBlockMetrics(nodes: Map<string, GraphNode>): void {
  for (const node of nodes.values()) {
    node.metrics = getBlockMetrics(node.block)
  }
}

/**
 * Creates a bounding box from position and dimensions
 */
export function createBoundingBox(
  position: { x: number; y: number },
  dimensions: Pick<BlockMetrics, 'width' | 'height'>
): BoundingBox {
  return {
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.height,
  }
}

/**
 * Checks if two bounding boxes overlap (with optional margin)
 */
export function boxesOverlap(box1: BoundingBox, box2: BoundingBox, margin = 0): boolean {
  return !(
    box1.x + box1.width + margin <= box2.x ||
    box2.x + box2.width + margin <= box1.x ||
    box1.y + box1.height + margin <= box2.y ||
    box2.y + box2.height + margin <= box1.y
  )
}

/**
 * Resolves the on-canvas dimensions of a note block.
 *
 * A note is fixed-width but sizes its height to its own content, so a stored
 * measurement is the best answer when there is one — bounded by the compact
 * minimum and the scrolling maximum the card itself honours.
 */
function getNoteDimensions(block: BlockState): { width: number; height: number } {
  const width = Math.max(
    resolveNumeric(block.data?.width, 0),
    block.layout?.measuredWidth ?? 0,
    BLOCK_DIMENSIONS.NOTE_WIDTH
  )

  /*
   * Unmeasured notes are sized from their content rather than assumed full
   * height: an empty note is a fraction of a filled one, and treating every
   * unmeasured note as filled makes it claim ~140px it never paints and pushes
   * the rest of its layer down.
   */
  const measuredHeight = Math.max(
    resolveNumeric(block.data?.height, 0),
    block.layout?.measuredHeight ?? 0,
    block.height ?? 0
  )
  const height =
    measuredHeight > 0
      ? clampNoteBlockTotalHeight(measuredHeight)
      : getNoteBlockHeight(isNoteContentEmpty(block.subBlocks?.content?.value))

  return { width, height }
}

/**
 * Checks if a block has a valid, finite position.
 * Returns false for missing, undefined, NaN, or Infinity coordinates.
 */
export function hasFinitePosition(block: BlockState): boolean {
  return Number.isFinite(block.position?.x) && Number.isFinite(block.position?.y)
}

/**
 * Determines whether a note and a block overlapped at their pre-layout
 * positions. Used by targeted layout to distinguish overlaps introduced by the
 * current pass from arrangements that already existed.
 */
function noteOverlappedBlockBefore(
  previousBlocks: Record<string, BlockState>,
  noteId: string,
  blockId: string
): boolean {
  const previousNote = previousBlocks[noteId]
  const previousBlock = previousBlocks[blockId]
  if (!previousNote || !previousBlock) return false

  // A block without a finite prior position was not yet placed on the canvas,
  // so it could not have overlapped anything before this pass.
  if (!hasFinitePosition(previousNote) || !hasFinitePosition(previousBlock)) return false

  // Derive dimensions from the prior blocks so a resize between passes does not
  // pair new dimensions with the old position.
  const noteBox = createBoundingBox(previousNote.position, getNoteDimensions(previousNote))
  const blockBox = createBoundingBox(previousBlock.position, getBlockMetrics(previousBlock))
  return boxesOverlap(blockBox, noteBox)
}

export interface ResolveNoteOverlapsOptions {
  /**
   * Pre-layout block snapshot. When provided, only notes whose overlap with a
   * block was *introduced* by the current pass are relocated (i.e. they overlap
   * now but did not at these positions). Targeted layout passes this so that
   * pre-existing note arrangements are preserved. When omitted (full
   * auto-layout), any note overlapping a block is relocated.
   */
  previousBlocks?: Record<string, BlockState>
}

/**
 * Relocates note blocks that overlap the laid-out workflow blocks.
 *
 * Notes are excluded from the topological layout because they are free-form
 * annotations, but repositioned workflow blocks can land on top of them. This
 * pass keeps notes that already sit in clear space and stacks any relocated
 * notes in a column beneath their parent group's blocks, preserving the notes'
 * relative reading order. Notes are grouped by parent so notes inside a
 * container are resolved against that container's children only.
 *
 * Placement is always computed against the full set of blocks and notes in the
 * group, so a relocated note never collides with anything regardless of which
 * overlaps triggered the relocation.
 */
export function resolveNoteOverlaps(
  blocks: Record<string, BlockState>,
  verticalSpacing: number,
  options: ResolveNoteOverlapsOptions = {}
): void {
  const { previousBlocks } = options
  const { root, children } = getBlocksByParent(blocks)
  const groups: string[][] = [root, ...Array.from(children.values())]

  for (const groupIds of groups) {
    const obstacles: Array<{ id: string; box: BoundingBox }> = []
    const noteIds: string[] = []
    let maxBottom = Number.NEGATIVE_INFINITY
    let minX = Number.POSITIVE_INFINITY

    for (const id of groupIds) {
      const block = blocks[id]
      // Skip non-finite positions so corrupted coordinates never propagate into
      // minX / maxBottom (and therefore into relocated note positions).
      if (!block || !hasFinitePosition(block)) continue

      if (block.type === NOTE_BLOCK_TYPE) {
        noteIds.push(id)
        const { height } = getNoteDimensions(block)
        maxBottom = Math.max(maxBottom, block.position.y + height)
        continue
      }

      if (shouldSkipAutoLayout(block)) continue

      const box = createBoundingBox(block.position, getBlockMetrics(block))
      obstacles.push({ id, box })
      maxBottom = Math.max(maxBottom, box.y + box.height)
      minX = Math.min(minX, box.x)
    }

    if (noteIds.length === 0 || obstacles.length === 0) continue

    noteIds.sort((a, b) => {
      const posA = blocks[a].position
      const posB = blocks[b].position
      return posA.y - posB.y || posA.x - posB.x
    })

    let stackY = maxBottom + verticalSpacing

    for (const id of noteIds) {
      const note = blocks[id]
      const dimensions = getNoteDimensions(note)
      const noteBox = createBoundingBox(note.position, dimensions)

      const needsRelocation = obstacles.some(({ id: blockId, box }) => {
        if (!boxesOverlap(box, noteBox)) return false
        if (previousBlocks) {
          return !noteOverlappedBlockBefore(previousBlocks, id, blockId)
        }
        return true
      })

      if (!needsRelocation) continue

      note.position = { x: minX, y: stackY }
      stackY += dimensions.height + verticalSpacing
    }
  }
}

/**
 * Groups blocks by their parent container
 */
export function getBlocksByParent(blocks: Record<string, BlockState>): {
  root: string[]
  children: Map<string, string[]>
} {
  const root: string[] = []
  const children = new Map<string, string[]>()

  for (const [id, block] of Object.entries(blocks)) {
    const parentId = block.data?.parentId

    if (!parentId) {
      root.push(id)
    } else {
      if (!children.has(parentId)) {
        children.set(parentId, [])
      }
      children.get(parentId)!.push(id)
    }
  }

  return { root, children }
}

/**
 * Normalizes node positions to start from a given padding offset.
 * Returns the bounding box dimensions of the normalized layout.
 */
export function normalizePositions(
  nodes: Map<string, GraphNode>,
  options: { isContainer: boolean }
): { width: number; height: number } {
  if (nodes.size === 0) {
    return { width: 0, height: 0 }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes.values()) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.metrics.width)
    maxY = Math.max(maxY, node.position.y + node.metrics.height)
  }

  const paddingX = options.isContainer ? CONTAINER_PADDING_X : ROOT_PADDING_X
  const paddingY = options.isContainer ? CONTAINER_PADDING_Y : ROOT_PADDING_Y

  const xOffset = paddingX - minX
  const yOffset = paddingY - minY

  for (const node of nodes.values()) {
    node.position = {
      x: node.position.x + xOffset,
      y: node.position.y + yOffset,
    }
  }

  const width = maxX - minX + CONTAINER_PADDING * 2
  const height = maxY - minY + CONTAINER_PADDING * 2

  return { width, height }
}

/**
 * Transfers block height measurements from source blocks to target blocks.
 * Matches blocks by type:name key.
 */
export function transferBlockHeights(
  sourceBlocks: Record<string, BlockState>,
  targetBlocks: Record<string, BlockState>
): void {
  // Build a map of block type+name to heights from source
  const heightMap = new Map<string, { height: number; width: number }>()

  for (const block of Object.values(sourceBlocks)) {
    const key = `${block.type}:${block.name}`
    heightMap.set(key, {
      /* A note carries its own width and compact height; every other card
         falls back to the shortest silhouette the border renderer paints. */
      height:
        block.height ||
        (block.type === NOTE_BLOCK_TYPE
          ? getNoteBlockHeight(true)
          : BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT),
      width:
        block.layout?.measuredWidth ||
        (block.type === NOTE_BLOCK_TYPE
          ? BLOCK_DIMENSIONS.NOTE_WIDTH
          : BLOCK_DIMENSIONS.FIXED_WIDTH),
    })
  }

  // Transfer heights to target blocks
  for (const block of Object.values(targetBlocks)) {
    const key = `${block.type}:${block.name}`
    const measurements = heightMap.get(key)

    if (measurements) {
      block.height = measurements.height

      if (!block.layout) {
        block.layout = {}
      }
      block.layout.measuredHeight = measurements.height
      block.layout.measuredWidth = measurements.width
    }
  }
}

/**
 * Calculates the internal depth (max layer count) for each subflow container.
 * Used to properly position blocks that connect after a subflow ends.
 *
 * @param blocks - All blocks in the workflow
 * @param edges - All edges in the workflow
 * @param assignLayersFn - Function to assign layers to blocks
 * @returns Map of container block IDs to their internal layer depth
 */
export function calculateSubflowDepths(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  assignLayersFn: (blocks: Record<string, BlockState>, edges: Edge[]) => Map<string, GraphNode>
): Map<string, number> {
  const depths = new Map<string, number>()
  const { children } = getBlocksByParent(blocks)

  for (const [containerId, childIds] of children.entries()) {
    if (childIds.length === 0) {
      depths.set(containerId, 1)
      continue
    }

    const childBlocks: Record<string, BlockState> = {}
    const layoutChildIds = filterLayoutEligibleBlockIds(childIds, blocks)
    for (const childId of layoutChildIds) {
      childBlocks[childId] = blocks[childId]
    }

    const childEdges = edges.filter(
      (edge) => layoutChildIds.includes(edge.source) && layoutChildIds.includes(edge.target)
    )

    if (Object.keys(childBlocks).length === 0) {
      depths.set(containerId, 1)
      continue
    }

    const childNodes = assignLayersFn(childBlocks, childEdges)
    let maxLayer = 0
    for (const node of childNodes.values()) {
      maxLayer = Math.max(maxLayer, node.layer)
    }

    depths.set(containerId, Math.max(maxLayer + 1, 1))
  }

  return depths
}

/**
 * Orders container IDs by nesting depth, deepest first.
 *
 * A container's size depends on its children, and a nested container counts as
 * one of those children, so inner containers must be resolved before the outer
 * ones that measure them.
 */
export function sortContainersDeepestFirst(
  containerIds: string[],
  blocks: Record<string, BlockState>
): string[] {
  const containerDepth = new Map<string, number>()

  for (const containerId of containerIds) {
    let depth = 0
    let currentId: string | undefined = containerId
    while (currentId) {
      const parentId: string | undefined = blocks[currentId]?.data?.parentId
      currentId = parentId
      if (currentId) depth++
    }
    containerDepth.set(containerId, depth)
  }

  return [...containerIds].sort(
    (a, b) => (containerDepth.get(b) ?? 0) - (containerDepth.get(a) ?? 0)
  )
}

/**
 * Layout function type for preparing container dimensions.
 * Returns laid out nodes and bounding dimensions.
 */
export type LayoutFunction = (
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: {
    isContainer: boolean
    layoutOptions?: {
      horizontalSpacing?: number
      verticalSpacing?: number
      padding?: { x: number; y: number }
      gridSize?: number
    }
    subflowDepths?: Map<string, number>
  }
) => { nodes: Map<string, GraphNode>; dimensions: { width: number; height: number } }

/**
 * Pre-calculates container dimensions by laying out their children.
 * Processes containers bottom-up to handle nested subflows correctly.
 * This ensures accurate width/height values before root-level layout.
 *
 * @param blocks - All blocks in the workflow (will be mutated with updated dimensions)
 * @param edges - All edges in the workflow
 * @param layoutFn - The layout function to use for calculating dimensions
 * @param horizontalSpacing - Horizontal spacing between blocks
 * @param verticalSpacing - Vertical spacing between blocks
 * @param gridSize - Optional grid size for snap-to-grid
 */
export function prepareContainerDimensions(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  layoutFn: LayoutFunction,
  horizontalSpacing: number,
  verticalSpacing: number,
  gridSize?: number
): void {
  const { children } = getBlocksByParent(blocks)

  const sortedContainerIds = sortContainersDeepestFirst(Array.from(children.keys()), blocks)

  // Process each container, laying out its children to determine dimensions
  for (const containerId of sortedContainerIds) {
    const container = blocks[containerId]
    if (!container) continue

    const childIds = children.get(containerId) ?? []
    const layoutChildIds = filterLayoutEligibleBlockIds(childIds, blocks)

    if (layoutChildIds.length === 0) {
      // Empty container - use default dimensions
      container.data = {
        ...container.data,
        width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
      }
      container.layout = {
        ...container.layout,
        measuredWidth: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        measuredHeight: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
      }
      continue
    }

    // Build subset of blocks and edges for this container's children
    const childBlocks: Record<string, BlockState> = {}
    for (const childId of layoutChildIds) {
      childBlocks[childId] = blocks[childId]
    }

    const childEdges = edges.filter(
      (edge) => layoutChildIds.includes(edge.source) && layoutChildIds.includes(edge.target)
    )

    // Layout children to get dimensions
    const { dimensions } = layoutFn(childBlocks, childEdges, {
      isContainer: true,
      layoutOptions: {
        horizontalSpacing: horizontalSpacing * 0.85,
        verticalSpacing,
        gridSize,
      },
    })

    // Update container with calculated dimensions
    const calculatedWidth = Math.max(dimensions.width, CONTAINER_DIMENSIONS.DEFAULT_WIDTH)
    const calculatedHeight = Math.max(dimensions.height, CONTAINER_DIMENSIONS.DEFAULT_HEIGHT)

    container.data = {
      ...container.data,
      width: calculatedWidth,
      height: calculatedHeight,
    }
    container.layout = {
      ...container.layout,
      measuredWidth: calculatedWidth,
      measuredHeight: calculatedHeight,
    }
  }
}
