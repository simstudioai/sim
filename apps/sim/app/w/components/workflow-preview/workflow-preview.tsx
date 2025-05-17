'use client'

import { useMemo, useEffect } from 'react'
import ReactFlow, {
  Background,
  ConnectionLineType,
  Edge,
  EdgeTypes,
  Handle,
  Node,
  NodeTypes,
  Position,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@/lib/logs/console-logger'
import { WorkflowBlock } from '@/app/w/[id]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/w/[id]/components/workflow-edge/workflow-edge'
import { LoopInput } from '@/app/w/[id]/components/workflow-loop/components/loop-input/loop-input'
import { LoopLabel } from '@/app/w/[id]/components/workflow-loop/components/loop-label/loop-label'
import { createLoopNode } from '@/app/w/[id]/components/workflow-loop/workflow-loop'
import { getBlock } from '@/blocks'
import { cn } from '@/lib/utils'

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
  loopLabel: LoopLabel,
  loopInput: LoopInput,
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
  // Use effect to log the workflow state once outside of useMemo
  useEffect(() => {
    logger.info('WorkflowPreview received new state', {
      blockCount: Object.keys(workflowState?.blocks || {}).length,
      withSubBlocks: Object.values(workflowState?.blocks || {}).filter(b => b.subBlocks && Object.keys(b.subBlocks).length > 0).length,
    });
  }, [workflowState]);
  
  // Transform blocks and loops into ReactFlow nodes
  const nodes: Node[] = useMemo(() => {
    const nodeArray: Node[] = []

    // Add loop nodes
    Object.entries(workflowState.loops || {}).forEach(([loopId, loop]) => {
      const loopNodes = createLoopNode({
        loopId,
        loop: loop as any,
        blocks: workflowState.blocks,
      })

      if (loopNodes) {
        if (Array.isArray(loopNodes)) {
          nodeArray.push(...(loopNodes as Node[]))
        } else {
          nodeArray.push(loopNodes)
        }
      }
    })

    // Add block nodes using the same approach as workflow.tsx
    Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.warn(`Skipping invalid block: ${blockId}`);
        return;
      }
    
      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { blockId })
        return;
      }

      // Create a deep clone of subBlocks to avoid any references to the original state
      const subBlocksClone = block.subBlocks ? JSON.parse(JSON.stringify(block.subBlocks)) : {};

      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: block.position,
        draggable: false,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          blockState: block,
          isReadOnly: true, // Set read-only mode for preview
          isPreview: true, // Indicate this is a preview
          subBlockValues: subBlocksClone, // Use the deep clone to avoid reference issues
        },
      })
      logger.info(`Preview node created: ${blockId}`, { 
        blockType: block.type,
        hasSubBlocks: block.subBlocks && Object.keys(block.subBlocks).length > 0
      });
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
      <div style={{ height, width }} className={cn(className, 'preview-mode')}>
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
