'use client'

import { useEffect, useMemo, useRef } from 'react'
import ReactFlow, {
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { createLogger } from '@sim/logger'
import { cn } from '@/lib/core/utils/cn'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import { estimateBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { PreviewBlock } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/block'
import { PreviewSubflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/subflow'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('PreviewWorkflow')

/**
 * Gets block dimensions for preview purposes.
 * For containers, uses stored dimensions or defaults.
 * For regular blocks, uses stored height or estimates based on type.
 */
function getPreviewBlockDimensions(block: BlockState): { width: number; height: number } {
  if (block.type === 'loop' || block.type === 'parallel') {
    return {
      width: block.data?.width
        ? Math.max(block.data.width, CONTAINER_DIMENSIONS.MIN_WIDTH)
        : CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: block.data?.height
        ? Math.max(block.data.height, CONTAINER_DIMENSIONS.MIN_HEIGHT)
        : CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
  }

  if (block.height) {
    return {
      width: BLOCK_DIMENSIONS.FIXED_WIDTH,
      height: Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
    }
  }

  return estimateBlockDimensions(block.type)
}

/**
 * Calculates container dimensions based on child block positions and sizes.
 * Mirrors the logic from useNodeUtilities.calculateLoopDimensions.
 */
function calculateContainerDimensions(
  containerId: string,
  blocks: Record<string, BlockState>
): { width: number; height: number } {
  const childBlocks = Object.values(blocks).filter((block) => block?.data?.parentId === containerId)

  if (childBlocks.length === 0) {
    return {
      width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
  }

  let maxRight = 0
  let maxBottom = 0

  for (const child of childBlocks) {
    if (!child?.position) continue

    const { width: childWidth, height: childHeight } = getPreviewBlockDimensions(child)

    maxRight = Math.max(maxRight, child.position.x + childWidth)
    maxBottom = Math.max(maxBottom, child.position.y + childHeight)
  }

  const width = Math.max(
    CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
    maxRight + CONTAINER_DIMENSIONS.RIGHT_PADDING
  )
  const height = Math.max(
    CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    maxBottom + CONTAINER_DIMENSIONS.BOTTOM_PADDING
  )

  return { width, height }
}

/**
 * Finds the leftmost block ID from a workflow state.
 * Excludes subflow containers (loop/parallel) from consideration.
 * @param workflowState - The workflow state to search
 * @returns The ID of the leftmost block, or null if no blocks exist
 */
export function getLeftmostBlockId(workflowState: WorkflowState | null | undefined): string | null {
  if (!workflowState?.blocks) return null

  let leftmostId: string | null = null
  let minX = Number.POSITIVE_INFINITY

  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    if (!block || block.type === 'loop' || block.type === 'parallel') continue
    const x = block.position?.x ?? Number.POSITIVE_INFINITY
    if (x < minX) {
      minX = x
      leftmostId = blockId
    }
  }

  return leftmostId
}

/** Execution status for edges/nodes in the preview */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

/** Calculates absolute position for blocks, handling nested subflows */
function calculateAbsolutePosition(
  block: BlockState,
  blocks: Record<string, BlockState>
): { x: number; y: number } {
  if (!block.data?.parentId) {
    return block.position
  }

  const parentBlock = blocks[block.data.parentId]
  if (!parentBlock) {
    logger.warn(`Parent block not found for child block`)
    return block.position
  }

  const parentAbsolutePosition = calculateAbsolutePosition(parentBlock, blocks)
  return {
    x: parentAbsolutePosition.x + block.position.x,
    y: parentAbsolutePosition.y + block.position.y,
  }
}

interface PreviewWorkflowProps {
  workflowState: WorkflowState
  className?: string
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultPosition?: { x: number; y: number }
  defaultZoom?: number
  fitPadding?: number
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
  /** Callback when a node is right-clicked */
  onNodeContextMenu?: (blockId: string, mousePosition: { x: number; y: number }) => void
  /** Callback when the canvas (empty area) is clicked */
  onPaneClick?: () => void
  /** Cursor style to show when hovering the canvas */
  cursorStyle?: 'default' | 'pointer' | 'grab'
  /** Map of executed block IDs to their status for highlighting the execution path */
  executedBlocks?: Record<string, { status: string }>
  /** Currently selected block ID for highlighting */
  selectedBlockId?: string | null
  /** Skips expensive subblock computations for thumbnails/template previews */
  lightweight?: boolean
}

/**
 * Preview node types using minimal components without hooks or store subscriptions.
 * This prevents interaction issues while allowing canvas panning and node clicking.
 */
const previewNodeTypes: NodeTypes = {
  workflowBlock: PreviewBlock,
  noteBlock: PreviewBlock,
  subflowNode: PreviewSubflow,
}

const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

interface FitViewOnChangeProps {
  nodeIds: string
  fitPadding: number
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Helper component that calls fitView when the set of nodes changes or when the container resizes.
 * Only triggers on actual node additions/removals, not on selection changes.
 * Must be rendered inside ReactFlowProvider.
 */
function FitViewOnChange({ nodeIds, fitPadding, containerRef }: FitViewOnChangeProps) {
  const { fitView } = useReactFlow()
  const lastNodeIdsRef = useRef<string | null>(null)

  useEffect(() => {
    if (!nodeIds.length) return
    const shouldFit = lastNodeIdsRef.current !== nodeIds
    if (!shouldFit) return
    lastNodeIdsRef.current = nodeIds

    const timeoutId = setTimeout(() => {
      fitView({ padding: fitPadding, duration: 200 })
    }, 50)
    return () => clearTimeout(timeoutId)
  }, [nodeIds, fitPadding, fitView])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        fitView({ padding: fitPadding, duration: 150 })
      }, 100)
    })

    resizeObserver.observe(container)
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [containerRef, fitPadding, fitView])

  return null
}

/**
 * Readonly workflow component for visualizing workflow state.
 * Renders blocks, subflows, and edges with execution status highlighting.
 *
 * @remarks
 * - Supports panning and node click interactions
 * - Shows execution path via green edges for successful paths
 * - Error edges display red by default, green when error path was taken
 * - Fits view automatically when nodes change or container resizes
 */
export function PreviewWorkflow({
  workflowState,
  className,
  height = '100%',
  width = '100%',
  isPannable = true,
  defaultPosition,
  defaultZoom = 0.8,
  fitPadding = 0.25,
  onNodeClick,
  onNodeContextMenu,
  onPaneClick,
  cursorStyle = 'grab',
  executedBlocks,
  selectedBlockId,
  lightweight = false,
}: PreviewWorkflowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeTypes = previewNodeTypes
  const isValidWorkflowState = workflowState?.blocks && workflowState.edges

  const blocksStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.blocks || {}).length,
      ids: Object.keys(workflowState.blocks || {}).join(','),
    }
  }, [workflowState.blocks, isValidWorkflowState])

  const loopsStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.loops || {}).length,
      ids: Object.keys(workflowState.loops || {}).join(','),
    }
  }, [workflowState.loops, isValidWorkflowState])

  const parallelsStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.parallels || {}).length,
      ids: Object.keys(workflowState.parallels || {}).join(','),
    }
  }, [workflowState.parallels, isValidWorkflowState])

  /** Map of subflow ID to child block IDs */
  const subflowChildrenMap = useMemo(() => {
    if (!isValidWorkflowState) return new Map<string, string[]>()

    const map = new Map<string, string[]>()
    for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
      const parentId = block?.data?.parentId
      if (parentId) {
        const children = map.get(parentId) || []
        children.push(blockId)
        map.set(parentId, children)
      }
    }
    return map
  }, [workflowState.blocks, isValidWorkflowState])

  /** Derives subflow execution status from child blocks */
  const getSubflowExecutionStatus = useMemo(() => {
    return (subflowId: string): ExecutionStatus | undefined => {
      if (!executedBlocks) return undefined

      const childIds = subflowChildrenMap.get(subflowId)
      if (!childIds?.length) return undefined

      const childStatuses = childIds.map((id) => executedBlocks[id]).filter(Boolean)
      if (childStatuses.length === 0) return undefined

      if (childStatuses.some((s) => s.status === 'error')) return 'error'
      if (childStatuses.some((s) => s.status === 'success')) return 'success'
      return 'not-executed'
    }
  }, [executedBlocks, subflowChildrenMap])

  /** Gets execution status for any block, deriving subflow status from children */
  const getBlockExecutionStatus = useMemo(() => {
    return (blockId: string): { status: string; executed: boolean } | undefined => {
      if (!executedBlocks) return undefined

      const directStatus = executedBlocks[blockId]
      if (directStatus) {
        return { status: directStatus.status, executed: true }
      }

      const block = workflowState.blocks?.[blockId]
      if (block && (block.type === 'loop' || block.type === 'parallel')) {
        const subflowStatus = getSubflowExecutionStatus(blockId)
        if (subflowStatus) {
          return { status: subflowStatus, executed: true }
        }

        const incomingEdge = workflowState.edges?.find((e) => e.target === blockId)
        if (incomingEdge && executedBlocks[incomingEdge.source]?.status === 'success') {
          return { status: 'not-executed', executed: true }
        }
      }

      return undefined
    }
  }, [executedBlocks, workflowState.blocks, workflowState.edges, getSubflowExecutionStatus])

  const edgesStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: workflowState.edges?.length || 0,
      ids: workflowState.edges?.map((e) => e.id).join(',') || '',
    }
  }, [workflowState.edges, isValidWorkflowState])

  const nodes: Node[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    const nodeArray: Node[] = []

    Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.warn(`Skipping invalid block: ${blockId}`)
        return
      }

      const absolutePosition = calculateAbsolutePosition(block, workflowState.blocks)

      if (block.type === 'loop' || block.type === 'parallel') {
        const isSelected = selectedBlockId === blockId
        const dimensions = calculateContainerDimensions(blockId, workflowState.blocks)
        const subflowExecutionStatus = getSubflowExecutionStatus(blockId)

        nodeArray.push({
          id: blockId,
          type: 'subflowNode',
          position: absolutePosition,
          draggable: false,
          data: {
            name: block.name,
            width: dimensions.width,
            height: dimensions.height,
            kind: block.type as 'loop' | 'parallel',
            isPreviewSelected: isSelected,
            executionStatus: subflowExecutionStatus,
            lightweight,
          },
        })
        return
      }

      const isSelected = selectedBlockId === blockId

      let executionStatus: ExecutionStatus | undefined
      if (executedBlocks) {
        const blockExecution = executedBlocks[blockId]
        if (blockExecution) {
          if (blockExecution.status === 'error') {
            executionStatus = 'error'
          } else if (blockExecution.status === 'success') {
            executionStatus = 'success'
          } else {
            executionStatus = 'not-executed'
          }
        } else {
          executionStatus = 'not-executed'
        }
      }

      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: absolutePosition,
        draggable: false,
        zIndex: block.data?.parentId ? 10 : undefined,
        data: {
          type: block.type,
          name: block.name,
          isTrigger: block.triggerMode === true,
          horizontalHandles: block.horizontalHandles ?? false,
          enabled: block.enabled ?? true,
          isPreviewSelected: isSelected,
          executionStatus,
          subBlockValues: block.subBlocks,
          lightweight,
        },
      })
    })

    return nodeArray
  }, [
    blocksStructure,
    loopsStructure,
    parallelsStructure,
    workflowState.blocks,
    isValidWorkflowState,
    executedBlocks,
    selectedBlockId,
    getSubflowExecutionStatus,
    lightweight,
  ])

  const edges: Edge[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    /**
     * Determines edge execution status for visualization.
     * Error edges turn green when taken (source errored, target executed).
     * Normal edges turn green when both source succeeded and target executed.
     */
    const getEdgeExecutionStatus = (edge: {
      source: string
      target: string
      sourceHandle?: string | null
    }): ExecutionStatus | undefined => {
      if (!executedBlocks) return undefined

      const sourceStatus = getBlockExecutionStatus(edge.source)
      const targetStatus = getBlockExecutionStatus(edge.target)
      const isErrorEdge = edge.sourceHandle === 'error'

      if (isErrorEdge) {
        return sourceStatus?.status === 'error' && targetStatus?.executed
          ? 'success'
          : 'not-executed'
      }

      const isSubflowStartEdge =
        edge.sourceHandle === 'loop-start-source' || edge.sourceHandle === 'parallel-start-source'

      if (isSubflowStartEdge) {
        const incomingEdge = workflowState.edges?.find((e) => e.target === edge.source)
        const incomingSucceeded = incomingEdge
          ? executedBlocks[incomingEdge.source]?.status === 'success'
          : false
        return incomingSucceeded ? 'success' : 'not-executed'
      }

      const targetBlock = workflowState.blocks?.[edge.target]
      const targetIsSubflow =
        targetBlock && (targetBlock.type === 'loop' || targetBlock.type === 'parallel')

      if (sourceStatus?.status === 'success' && (targetStatus?.executed || targetIsSubflow)) {
        return 'success'
      }

      return 'not-executed'
    }

    return (workflowState.edges || []).map((edge) => {
      const status = getEdgeExecutionStatus(edge)
      const isErrorEdge = edge.sourceHandle === 'error'
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        data: {
          ...(status ? { executionStatus: status } : {}),
          sourceHandle: edge.sourceHandle,
        },
        zIndex: status === 'success' ? 10 : isErrorEdge ? 5 : 0,
      }
    })
  }, [
    edgesStructure,
    workflowState.edges,
    workflowState.blocks,
    isValidWorkflowState,
    executedBlocks,
    getBlockExecutionStatus,
  ])

  if (!isValidWorkflowState) {
    return (
      <div
        style={{ height, width }}
        className='flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'
      >
        <div className='text-center text-gray-500 dark:text-gray-400'>
          <div className='mb-2 font-medium text-lg'>⚠️ Logged State Not Found</div>
          <div className='text-sm'>
            This log was migrated from the old system and doesn't contain workflow state data.
          </div>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div
        ref={containerRef}
        style={{ height, width, backgroundColor: 'var(--bg)' }}
        className={cn('preview-mode', onNodeClick && 'interactive-nodes', className)}
      >
        <style>{`
          /* Canvas cursor - grab on the flow container and pane */
          .preview-mode .react-flow { cursor: ${cursorStyle}; }
          .preview-mode .react-flow__pane { cursor: ${cursorStyle} !important; }
          .preview-mode .react-flow__selectionpane { cursor: ${cursorStyle} !important; }
          .preview-mode .react-flow__renderer { cursor: ${cursorStyle}; }

          /* Active/grabbing cursor when dragging */
          ${
            cursorStyle === 'grab'
              ? `
          .preview-mode .react-flow:active { cursor: grabbing; }
          .preview-mode .react-flow__pane:active { cursor: grabbing !important; }
          .preview-mode .react-flow__selectionpane:active { cursor: grabbing !important; }
          .preview-mode .react-flow__renderer:active { cursor: grabbing; }
          .preview-mode .react-flow__node:active { cursor: grabbing !important; }
          .preview-mode .react-flow__node:active * { cursor: grabbing !important; }
          `
              : ''
          }

          /* Node cursor - pointer on nodes when onNodeClick is provided */
          .preview-mode.interactive-nodes .react-flow__node { cursor: pointer !important; }
          .preview-mode.interactive-nodes .react-flow__node > div { cursor: pointer !important; }
          .preview-mode.interactive-nodes .react-flow__node * { cursor: pointer !important; }
        `}</style>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
          fitViewOptions={{ padding: fitPadding }}
          panOnScroll={isPannable}
          panOnDrag={isPannable}
          zoomOnScroll={false}
          draggable={false}
          defaultViewport={{
            x: defaultPosition?.x ?? 0,
            y: defaultPosition?.y ?? 0,
            zoom: defaultZoom ?? 1,
          }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          elementsSelectable={false}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={
            onNodeClick
              ? (event, node) => {
                  logger.debug('Node clicked:', { nodeId: node.id, event })
                  onNodeClick(node.id, { x: event.clientX, y: event.clientY })
                }
              : undefined
          }
          onNodeContextMenu={
            onNodeContextMenu
              ? (event, node) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onNodeContextMenu(node.id, { x: event.clientX, y: event.clientY })
                }
              : undefined
          }
          onPaneClick={onPaneClick}
        />
        <FitViewOnChange
          nodeIds={blocksStructure.ids}
          fitPadding={fitPadding}
          containerRef={containerRef}
        />
      </div>
    </ReactFlowProvider>
  )
}
