'use client'

import { useMemo } from 'react'
import { cloneDeep } from 'lodash'
import ReactFlow, {
  Background,
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { LoopNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/loop-node/loop-node'
import { ParallelNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/parallel-node/parallel-node'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
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
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
}

// Define node types - the components now handle preview mode internally
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  loopNode: LoopNodeComponent,
  parallelNode: ParallelNodeComponent,
}

// Define edge types
const edgeTypes: EdgeTypes = {
  workflowEdge: WorkflowEdge,
}

export function WorkflowPreview({
  workflowState,
  showSubBlocks = true,
  height = '100%',
  width = '100%',
  isPannable = false,
  defaultPosition,
  defaultZoom,
  onNodeClick,
}: WorkflowPreviewProps) {
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

      if (block.type === 'loop') {
        nodeArray.push({
          id: block.id,
          type: 'loopNode',
          position: absolutePosition,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          draggable: false,
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            state: 'valid',
            isPreview: true,
          },
        })
        return
      }

      if (block.type === 'parallel') {
        nodeArray.push({
          id: block.id,
          type: 'parallelNode',
          position: absolutePosition,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          draggable: false,
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            state: 'valid',
            isPreview: true,
          },
        })
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { blockId })
        return
      }

      const subBlocksClone = block.subBlocks ? cloneDeep(block.subBlocks) : {}

      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: absolutePosition,
        draggable: false,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          blockState: block,
          canEdit: false,
          isPreview: true,
          subBlockValues: subBlocksClone,
        },
      })

      if (block.type === 'loop') {
        const childBlocks = Object.entries(workflowState.blocks || {}).filter(
          ([_, childBlock]) => childBlock.data?.parentId === blockId
        )

        childBlocks.forEach(([childId, childBlock]) => {
          const childConfig = getBlock(childBlock.type)

          if (childConfig) {
            nodeArray.push({
              id: childId,
              type: 'workflowBlock',
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
  ])

  const edges: Edge[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    return (workflowState.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'workflowEdge',
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
      <div style={{ height, width }} className={cn('preview-mode')}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
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
        >
          <Background />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  )
}
