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
import { LoopTool } from '@/app/w/[id]/components/loop-node/loop-config'
import { WorkflowBlock } from '@/app/w/[id]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/w/[id]/components/workflow-edge/workflow-edge'
import { getBlock } from '@/blocks'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowPreview')

interface WorkflowPreviewProps {
  // The workflow state to render
  workflowState: WorkflowState
  // Whether to show subblocks
  showSubBlocks?: boolean
  // Optional className for container styling
  className?: string
  // Optional height/width overrides
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultPosition?: { x: number; y: number }
  defaultZoom?: number
}

// Define node types - using the actual workflow components
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  // loopLabel: LoopLabel,
  // loopInput: LoopInput,
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
}: WorkflowPreviewProps) {
  // Track structure changes efficiently
  const blocksStructure = useMemo(
    () => ({
      count: Object.keys(workflowState.blocks || {}).length,
      ids: Object.keys(workflowState.blocks || {}).join(','),
    }),
    [workflowState.blocks]
  )

  const loopsStructure = useMemo(
    () => ({
      count: Object.keys(workflowState.loops || {}).length,
      ids: Object.keys(workflowState.loops || {}).join(','),
    }),
    [workflowState.loops]
  )

  const parallelsStructure = useMemo(
    () => ({
      count: Object.keys(workflowState.parallels || {}).length,
      ids: Object.keys(workflowState.parallels || {}).join(','),
    }),
    [workflowState.parallels]
  )

  const edgesStructure = useMemo(
    () => ({
      count: workflowState.edges.length,
      ids: workflowState.edges.map((e) => e.id).join(','),
    }),
    [workflowState.edges]
  )

  // Transform blocks and loops into ReactFlow nodes
  const nodes: Node[] = useMemo(() => {
    const nodeArray: Node[] = []

    // First, get all blocks with parent-child relationships
    const blocksWithParents: Record<string, any> = {}
    const topLevelBlocks: Record<string, any> = {}

    // Categorize blocks as top-level or child blocks
    Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
      if (block.data?.parentId) {
        // This is a child block
        blocksWithParents[blockId] = block
      } else {
        // This is a top-level block
        topLevelBlocks[blockId] = block
      }
    })

    // Add block nodes using the same approach as workflow.tsx
    Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.warn(`Skipping invalid block: ${blockId}`)
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { blockId })
        return
      }

      // Create a deep clone of subBlocks to avoid any references to the original state
      const subBlocksClone = block.subBlocks ? cloneDeep(block.subBlocks) : {}

      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: block.position,
        draggable: false,
        data: {
          type: block.type,
          config: blockConfig || (block.type === 'loop' ? LoopTool : null),
          name: block.name,
          blockState: block,
          isReadOnly: true, // Set read-only mode for preview
          isPreview: true, // Indicate this is a preview
          subBlockValues: subBlocksClone, // Use the deep clone to avoid reference issues
        },
      })

      // Add children of this block if it's a loop
      if (block.type === 'loop') {
        // Find all children of this loop
        const childBlocks = Object.entries(blocksWithParents).filter(
          ([_, childBlock]) => childBlock.data?.parentId === blockId
        )

        // Add all child blocks to the node array
        childBlocks.forEach(([childId, childBlock]) => {
          const childConfig = getBlock(childBlock.type)

          nodeArray.push({
            id: childId,
            type: 'workflowBlock',
            // Position child blocks relative to the parent
            position: {
              x: block.position.x + 50, // Offset children to the right
              y: block.position.y + (childBlock.position?.y || 100), // Preserve vertical positioning
            },
            data: {
              type: childBlock.type,
              config: childConfig,
              name: childBlock.name,
              blockState: childBlock,
              showSubBlocks,
              isChild: true,
              parentId: blockId,
            },
            draggable: false,
          })
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
    workflowState.loops,
    workflowState.parallels,
  ])

  // Transform edges
  const edges: Edge[] = useMemo(() => {
    return workflowState.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'workflowEdge',
    }))
  }, [edgesStructure, workflowState.edges, workflowState.parallels])

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
        >
          <Background />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  )
}
