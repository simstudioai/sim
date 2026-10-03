import {
  BLOCK_Z_BASE,
  type CanvasSentenceSegment,
  CONTAINER_CHILD_Z_BASE,
  getEdgeZIndex,
  getEdgeZIndexForTarget,
} from '@sim/workflow-renderer'
import { type Edge, Position } from '@xyflow/react'
import type {
  DocsBlockData,
  DocsBlockNodeType,
} from '@/components/workflow-preview/docs-block-node'
import type {
  DocsContainerData,
  DocsContainerNodeType,
} from '@/components/workflow-preview/docs-container-node'

/**
 * Tool entry displayed as a chip on a block (e.g. an Agent's attached tools).
 */
export interface PreviewTool {
  name: string
  type: string
  bgColor: string
}

/**
 * A single block in a preview workflow. Presentational shape — authored by hand
 * for docs diagrams, not the app's full serialized block state.
 */
export interface PreviewBlock {
  id: string
  name: string
  type: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  /** Resolved example copy; value slots refer to the titles in `rows`. */
  sentence?: readonly CanvasSentenceSegment[]
  typeLabel?: string
  isIntegration?: boolean
  triggerMode?: boolean
  /**
   * Branch rows, each with its own right-edge source handle whose id is the
   * branch id. Author ids in the app's own handle scheme so edges match the
   * real workflow representation verbatim: `condition-<id>` on Condition
   * blocks, `router-<routeId>` on Routers.
   */
  branches?: Array<{ id: string; label: string; value?: string }>
  tools?: PreviewTool[]
  position: { x: number; y: number }
  hideTargetHandle?: boolean
  /** When set, the block renders as a Loop/Parallel container sized to hold its children. */
  size?: { width: number; height: number }
  /** Id of the container block this block sits inside. Its position is relative to the container. */
  parentId?: string
}

/**
 * A workflow rendered as a read-only, app-styled diagram in the docs.
 */
export interface PreviewWorkflow {
  id: string
  name: string
  blocks: PreviewBlock[]
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>
}

export type PreviewNode = DocsBlockNodeType | DocsContainerNodeType

export interface PreviewEdgeData extends Record<string, unknown> {
  animate: boolean
  delay: number
}

export type PreviewFlowEdge = Edge<PreviewEdgeData, 'previewEdge'>

export const BLOCK_STAGGER = 0.12
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

const EDGE_STYLE = { stroke: 'var(--workflow-edge)', strokeWidth: 2 } as const
const EDGE_STYLE_HIGHLIGHT = { stroke: 'var(--brand-secondary)', strokeWidth: 2.5 } as const
/** Edges leaving a block's error port render red, matching the editor. */
const EDGE_STYLE_ERROR = { stroke: 'var(--text-error)', strokeWidth: 2 } as const

/** De-emphasizes diagram context without reducing the contrast of its text. */
export const DIMMED_PREVIEW_CLASS =
  '[&_[data-workflow-block-border]]:opacity-35 [&_[data-workflow-type-accent]]:grayscale [&_[data-subflow-type-tag]]:grayscale'

/** Optional emphasis: light one block or one edge and dim everything else. */
export interface HighlightOptions {
  highlightBlock?: string
  highlightEdge?: string
  /** Ring one block (selection) without dimming the rest. */
  selectedBlock?: string
}

/** Semantic container depth used for z-order while docs positions stay flattened. */
function getNestingDepth(block: PreviewBlock, blocksById: Map<string, PreviewBlock>): number {
  let depth = 0
  let parentId = block.parentId
  const visited = new Set<string>()

  while (parentId && !visited.has(parentId)) {
    const parent = blocksById.get(parentId)
    if (!parent) break

    visited.add(parentId)
    depth += 1
    parentId = parent.parentId
  }

  return depth
}

/**
 * Converts a {@link PreviewWorkflow} to React Flow nodes and edges.
 *
 * @param workflow - The workflow definition
 * @param animate - When true, node/edge data carries stagger metadata
 * @param highlight - Optional block/edge to emphasize (dims the rest)
 */
export function toReactFlowElements(
  workflow: PreviewWorkflow,
  animate = false,
  highlight: HighlightOptions = {}
): { nodes: PreviewNode[]; edges: PreviewFlowEdge[] } {
  const { highlightBlock, highlightEdge, selectedBlock } = highlight
  const hasHighlight = Boolean(highlightBlock || highlightEdge)
  const blockIndexMap = new Map(workflow.blocks.map((b, i) => [b.id, i]))

  const blocksById = new Map(workflow.blocks.map((b) => [b.id, b]))
  const errorSources = new Set(
    workflow.edges.filter((edge) => edge.sourceHandle === 'error').map((edge) => edge.source)
  )

  const nodes: PreviewNode[] = workflow.blocks.map((block, index) => {
    const isContainer = Boolean(block.size)
    const nestingDepth = getNestingDepth(block, blocksById)
    // Nested blocks are authored relative to their container; render them at
    // absolute coordinates (not React Flow parentNode children) so the edges
    // between a container and its nested blocks render reliably and on top.
    const parent = block.parentId ? blocksById.get(block.parentId) : undefined
    const position = parent
      ? { x: parent.position.x + block.position.x, y: parent.position.y + block.position.y }
      : block.position
    const commonNode = {
      id: block.id,
      position,
      zIndex: isContainer ? nestingDepth : block.parentId ? CONTAINER_CHILD_Z_BASE : BLOCK_Z_BASE,
      ...(block.size ? { style: { width: block.size.width, height: block.size.height } } : {}),
      draggable: true,
      selectable: false,
      connectable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }

    if (isContainer) {
      const data: DocsContainerData = {
        name: block.name,
        blockType: block.type,
        bgColor: block.bgColor,
        rows: block.rows,
        branches: block.branches,
        tools: block.tools,
        hideTargetHandle: block.hideTargetHandle,
        size: block.size,
        parentId: block.parentId,
        index,
        animate,
        isHighlighted: highlightBlock === block.id || selectedBlock === block.id,
        isDimmed: hasHighlight && highlightBlock !== block.id && selectedBlock !== block.id,
      }
      return {
        ...commonNode,
        type: 'previewContainer',
        data,
      }
    }

    const data: DocsBlockData = {
      name: block.name,
      blockType: block.type,
      bgColor: block.bgColor,
      rows: block.rows,
      sentence: block.sentence,
      typeLabel: block.typeLabel,
      isIntegration: block.isIntegration,
      triggerMode: block.triggerMode,
      hasErrorConnection: errorSources.has(block.id),
      branches: block.branches,
      tools: block.tools,
      hideTargetHandle: block.hideTargetHandle,
      size: block.size,
      parentId: block.parentId,
      index,
      animate,
      isHighlighted: highlightBlock === block.id || selectedBlock === block.id,
      isDimmed: hasHighlight && highlightBlock !== block.id && selectedBlock !== block.id,
    }
    return {
      ...commonNode,
      type: 'previewBlock',
      data,
    }
  })

  const edges: PreviewFlowEdge[] = workflow.edges.map((e) => {
    const sourceIndex = blockIndexMap.get(e.source) ?? 0
    const isEdgeHighlight = highlightEdge === e.id
    const dimmed = hasHighlight && !isEdgeHighlight
    const isErrorEdge = e.sourceHandle === 'error'
    // Subflow containers expose a right-edge output handle (`loop-end-source` /
    // `parallel-end-source`) and a left-edge input handle with no id; regular
    // blocks use `source` / `target`. Resolve each end to the block's real handle
    // so edges into and out of Loop/Parallel containers still connect.
    const sourceBlock = blocksById.get(e.source)
    const targetBlock = blocksById.get(e.target)
    const parentContainer = blocksById.get(sourceBlock?.parentId ?? targetBlock?.parentId ?? '')
    const baseZIndex = getEdgeZIndex(
      parentContainer ? getNestingDepth(parentContainer, blocksById) : undefined,
      { isHighlighted: isEdgeHighlight }
    )
    const targetContainerZIndex = targetBlock?.size
      ? getNestingDepth(targetBlock, blocksById)
      : undefined
    const sourceHandle =
      e.sourceHandle ?? (sourceBlock?.size ? `${sourceBlock.type}-end-source` : 'source')
    const targetHandle = targetBlock?.size ? undefined : 'target'
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'previewEdge',
      animated: false,
      style: {
        ...(isEdgeHighlight ? EDGE_STYLE_HIGHLIGHT : isErrorEdge ? EDGE_STYLE_ERROR : EDGE_STYLE),
        opacity: dimmed ? 0.35 : 1,
      },
      sourceHandle,
      targetHandle,
      zIndex: getEdgeZIndexForTarget(baseZIndex, targetContainerZIndex),
      data: {
        animate,
        delay: animate ? sourceIndex * BLOCK_STAGGER + BLOCK_STAGGER : 0,
      },
    }
  })

  return { nodes, edges }
}
