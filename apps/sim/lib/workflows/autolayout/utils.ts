import {
  AUTO_LAYOUT_EXCLUDED_TYPES,
  CONTAINER_BLOCK_TYPES,
  CONTAINER_PADDING,
  CONTAINER_PADDING_X,
  CONTAINER_PADDING_Y,
  ROOT_PADDING_X,
  ROOT_PADDING_Y,
} from '@/lib/workflows/autolayout/constants'
import type { BlockMetrics, BoundingBox, Edge, GraphNode } from '@/lib/workflows/autolayout/types'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import type { BlockState } from '@/stores/workflows/workflow/types'

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
    minWidth: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
    minHeight: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    paddingTop: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingBottom: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingLeft: BLOCK_DIMENSIONS.HEADER_HEIGHT,
    paddingRight: BLOCK_DIMENSIONS.HEADER_HEIGHT,
  }
}

/**
 * Gets metrics for a regular (non-container) block
 */
function getRegularBlockMetrics(block: BlockState): BlockMetrics {
  const minWidth = BLOCK_DIMENSIONS.FIXED_WIDTH
  const minHeight = BLOCK_DIMENSIONS.MIN_HEIGHT
  const measuredH = block.layout?.measuredHeight ?? block.height
  const measuredW = block.layout?.measuredWidth

  const width = Math.max(measuredW ?? minWidth, minWidth)
  const height = Math.max(measuredH ?? minHeight, minHeight)

  return {
    width,
    height,
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
      height: block.height || BLOCK_DIMENSIONS.MIN_HEIGHT,
      width: block.layout?.measuredWidth || BLOCK_DIMENSIONS.FIXED_WIDTH,
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

  // Build dependency graph to process nested containers bottom-up
  const containerIds = Array.from(children.keys())
  const containerDepth = new Map<string, number>()

  // Calculate nesting depth for each container
  for (const containerId of containerIds) {
    let depth = 0
    let currentId: string | undefined = containerId
    while (currentId) {
      const block: BlockState | undefined = blocks[currentId]
      const parentId: string | undefined = block?.data?.parentId
      currentId = parentId
      if (currentId) depth++
    }
    containerDepth.set(containerId, depth)
  }

  // Sort containers by depth (deepest first) for bottom-up processing
  const sortedContainerIds = containerIds.sort((a, b) => {
    const depthA = containerDepth.get(a) ?? 0
    const depthB = containerDepth.get(b) ?? 0
    return depthB - depthA
  })

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
