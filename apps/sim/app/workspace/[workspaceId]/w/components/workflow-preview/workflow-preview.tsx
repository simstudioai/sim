'use client'

import { useEffect, useMemo } from 'react'
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
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import { WorkflowPreviewBlock } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview-block'
import { WorkflowPreviewSubflow } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview-subflow'
import { getBlock } from '@/blocks'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowPreview')

interface WorkflowPreviewProps {
  workflowState: WorkflowState
  showSubBlocks?: boolean
  className?: string
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultPosition?: { x: number; y: number }
  defaultZoom?: number
  fitPadding?: number
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
  /** Use lightweight blocks for better performance in template cards */
  lightweight?: boolean
  /** Cursor style to show when hovering the canvas */
  cursorStyle?: 'default' | 'pointer' | 'grab'
}

/**
 * Full node types with interactive WorkflowBlock for detailed previews
 */
const fullNodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  subflowNode: SubflowNodeComponent,
}

/**
 * Lightweight node types for template cards and other high-volume previews.
 * Uses minimal components without hooks or store subscriptions.
 */
const lightweightNodeTypes: NodeTypes = {
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
  nodes: Node[]
  fitPadding: number
}

/**
 * Helper component that calls fitView when nodes change.
 * Must be rendered inside ReactFlowProvider.
 */
function FitViewOnChange({ nodes, fitPadding }: FitViewOnChangeProps) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (nodes.length > 0) {
      // Small delay to ensure nodes are rendered before fitting
      const timeoutId = setTimeout(() => {
        fitView({ padding: fitPadding, duration: 200 })
      }, 50)
      return () => clearTimeout(timeoutId)
    }
  }, [nodes, fitPadding, fitView])

  return null
}

export function WorkflowPreview({
  workflowState,
  showSubBlocks = true,
  className,
  height = '100%',
  width = '100%',
  isPannable = false,
  defaultPosition,
  defaultZoom = 0.8,
  fitPadding = 0.25,
  onNodeClick,
  lightweight = false,
  cursorStyle = 'grab',
}: WorkflowPreviewProps) {
  // Use lightweight node types for better performance in template cards
  const nodeTypes = lightweight ? lightweightNodeTypes : fullNodeTypes
  // Check if the workflow state is valid
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

      // Lightweight mode: create minimal node data for performance
      if (lightweight) {
        // Handle loops and parallels as subflow nodes
        if (block.type === 'loop' || block.type === 'parallel') {
          nodeArray.push({
            id: blockId,
            type: 'subflowNode',
            position: absolutePosition,
            draggable: false,
            data: {
              name: block.name,
              width: block.data?.width || 500,
              height: block.data?.height || 300,
              kind: block.type as 'loop' | 'parallel',
            },
          })
          return
        }

        // Regular blocks
        nodeArray.push({
          id: blockId,
          type: 'workflowBlock',
          position: absolutePosition,
          draggable: false,
          data: {
            type: block.type,
            name: block.name,
            isTrigger: block.triggerMode === true,
            horizontalHandles: block.horizontalHandles ?? false,
            enabled: block.enabled ?? true,
          },
        })
        return
      }

      // Full mode: create detailed node data for interactive previews
      if (block.type === 'loop') {
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: absolutePosition,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          draggable: false,
          data: {
            ...block.data,
            name: block.name,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            state: 'valid',
            isPreview: true,
            kind: 'loop',
          },
        })
        return
      }

      if (block.type === 'parallel') {
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: absolutePosition,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          draggable: false,
          data: {
            ...block.data,
            name: block.name,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            state: 'valid',
            isPreview: true,
            kind: 'parallel',
          },
        })
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { blockId })
        return
      }

      const nodeType = block.type === 'note' ? 'noteBlock' : 'workflowBlock'

      nodeArray.push({
        id: blockId,
        type: nodeType,
        position: absolutePosition,
        draggable: false,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          blockState: block,
          canEdit: false,
          isPreview: true,
          subBlockValues: block.subBlocks ?? {},
        },
      })

      if (block.type === 'loop') {
        const childBlocks = Object.entries(workflowState.blocks || {}).filter(
          ([_, childBlock]) => childBlock.data?.parentId === blockId
        )

        childBlocks.forEach(([childId, childBlock]) => {
          const childConfig = getBlock(childBlock.type)

          if (childConfig) {
            const childNodeType = childBlock.type === 'note' ? 'noteBlock' : 'workflowBlock'

            nodeArray.push({
              id: childId,
              type: childNodeType,
              position: {
                x: block.position.x + 50,
                y: block.position.y + (childBlock.position?.y || 100),
              },
              data: {
                type: childBlock.type,
                config: childConfig,
                name: childBlock.name,
                blockState: childBlock,
                showSubBlocks,
                isChild: true,
                parentId: blockId,
                canEdit: false,
                isPreview: true,
              },
              draggable: false,
            })
          }
        })
      }
    })

    return nodeArray
  }, [
    blocksStructure,
    loopsStructure,
    parallelsStructure,
    showSubBlocks,
    workflowState.blocks,
    isValidWorkflowState,
    lightweight,
  ])

  const edges: Edge[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    return (workflowState.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }))
  }, [edgesStructure, workflowState.edges, isValidWorkflowState])

  // Handle migrated logs that don't have complete workflow state
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
        style={{ height, width, backgroundColor: 'var(--bg)' }}
        className={cn('preview-mode', className)}
      >
        {cursorStyle && (
          <style>{`
            .preview-mode .react-flow__pane {
              cursor: ${cursorStyle} !important;
            }
          `}</style>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
          fitViewOptions={{ padding: fitPadding }}
          panOnScroll={false}
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
        />
        <FitViewOnChange nodes={nodes} fitPadding={fitPadding} />
      </div>
    </ReactFlowProvider>
  )
}
