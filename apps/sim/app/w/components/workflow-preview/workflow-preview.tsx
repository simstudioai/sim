'use client'

import { useMemo, useEffect } from 'react'
import ReactFlow, {
  Background,
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  Handle,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { LoopTool } from '@/app/w/[id]/components/loop-node/loop-config'
import { createLogger } from '@/lib/logs/console-logger'
import { WorkflowBlock } from '@/app/w/[id]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/w/[id]/components/workflow-edge/workflow-edge'
// import { LoopInput } from '@/app/w/[id]/components/workflow-loop/components/loop-input/loop-input'
// import { LoopLabel } from '@/app/w/[id]/components/workflow-loop/components/loop-label/loop-label'
// import { createLoopNode } from '@/app/w/[id]/components/workflow-loop/workflow-loop'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('WorkflowPreview')

interface WorkflowPreviewProps {
  // The workflow state to render
  workflowState: {
    blocks: Record<string, any>
    edges: Array<{
      id: string
      source: string
      target: string
      sourceHandle?: string
      targetHandle?: string
    }>
    loops: Record<string, any>
  }
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

// The subblocks should be getting passed from the state and not the subBlockStore. 
// Create optional parameter boolan isPreview to pass in the block state to know how to render
// the subblocks

export function WorkflowPreview({
  workflowState,
  showSubBlocks = true,
  className,
  height = '100%',
  width = '100%',
  isPannable = false,
  defaultPosition,
  defaultZoom,
}: WorkflowPreviewProps) {
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
      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { blockId })
        return
      }

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
          subBlockValues: block.subBlocks || {}, // Use empty object as fallback
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
  }, [JSON.stringify(workflowState.blocks), JSON.stringify(workflowState.loops), showSubBlocks])

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
  }, [JSON.stringify(workflowState.edges)])

  useEffect(() => {
    logger.info('Rendering workflow state', { workflowState })
  }, [workflowState])

  return (
    <ReactFlowProvider>
      <div style={{ height, width }} className={className}>
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
