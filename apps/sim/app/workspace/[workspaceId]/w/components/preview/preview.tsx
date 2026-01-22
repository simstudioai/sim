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
import { WorkflowPreviewBlock } from '@/app/workspace/[workspaceId]/w/components/preview/components/block'
import { WorkflowPreviewSubflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/subflow'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowPreview')

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
 * Returns the block with the smallest x position, excluding subflow containers (loop/parallel).
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

interface WorkflowPreviewProps {
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
}

/**
 * Preview node types using minimal components without hooks or store subscriptions.
 * This prevents interaction issues while allowing canvas panning and node clicking.
 */
const previewNodeTypes: NodeTypes = {
  workflowBlock: WorkflowPreviewBlock,
  noteBlock: WorkflowPreviewBlock,
  subflowNode: WorkflowPreviewSubflow,
}

// Define edge types
const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge, // Keep for backward compatibility
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

  // Fit view when nodes change
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

  // Fit view when container resizes (debounced to avoid excessive calls during drag)
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

export function WorkflowPreview({
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
}: WorkflowPreviewProps) {
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

  const edgesStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: workflowState.edges?.length || 0,
      ids: workflowState.edges?.map((e) => e.id).join(',') || '',
    }
  }, [workflowState.edges, isValidWorkflowState])

  const calculateAbsolutePosition = (
    block: any,
    blocks: Record<string, any>
  ): { x: number; y: number } => {
    if (!block.data?.parentId) {
      return block.position
    }

    const parentBlock = blocks[block.data.parentId]
    if (!parentBlock) {
      logger.warn(`Parent block not found for child block: ${block.id}`)
      return block.position
    }

    const parentAbsolutePosition = calculateAbsolutePosition(parentBlock, blocks)

    return {
      x: parentAbsolutePosition.x + block.position.x,
      y: parentAbsolutePosition.y + block.position.y,
    }
  }

  const nodes: Node[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    const nodeArray: Node[] = []

    Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.warn(`Skipping invalid block: ${blockId}`)
        return
      }

      const absolutePosition = calculateAbsolutePosition(block, workflowState.blocks)

      // Handle loop/parallel containers
      if (block.type === 'loop' || block.type === 'parallel') {
        const isSelected = selectedBlockId === blockId
        const dimensions = calculateContainerDimensions(blockId, workflowState.blocks)
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
          },
        })
        return
      }

      // Handle regular blocks
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
        // Blocks inside subflows need higher z-index to appear above the container
        zIndex: block.data?.parentId ? 10 : undefined,
        data: {
          type: block.type,
          name: block.name,
          isTrigger: block.triggerMode === true,
          horizontalHandles: block.horizontalHandles ?? false,
          enabled: block.enabled ?? true,
          isPreviewSelected: isSelected,
          executionStatus,
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
  ])

  const edges: Edge[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    return (workflowState.edges || []).map((edge) => {
      let executionStatus: ExecutionStatus | undefined
      if (executedBlocks) {
        const sourceExecuted = executedBlocks[edge.source]
        const targetExecuted = executedBlocks[edge.target]

        if (sourceExecuted && targetExecuted) {
          // Edge is success if source succeeded and target was executed (even if target errored)
          if (sourceExecuted.status === 'success') {
            executionStatus = 'success'
          } else {
            executionStatus = 'not-executed'
          }
        } else {
          executionStatus = 'not-executed'
        }
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        data: executionStatus ? { executionStatus } : undefined,
        // Raise executed edges above default edges
        zIndex: executionStatus === 'success' ? 10 : 0,
      }
    })
  }, [edgesStructure, workflowState.edges, isValidWorkflowState, executedBlocks])

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
