'use client'

import { useMemo } from 'react'
import ReactFlow, {
  Background,
  ConnectionLineType,
  Edge,
  EdgeTypes,
  Handle,
  Node,
  NodeProps,
  NodeTypes,
  Position,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { WorkflowEdge } from '@/app/w/[id]/components/workflow-edge/workflow-edge'
import { LoopInput } from '@/app/w/[id]/components/workflow-loop/components/loop-input/loop-input'
import { LoopLabel } from '@/app/w/[id]/components/workflow-loop/components/loop-label/loop-label'
import { createLoopNode } from '@/app/w/[id]/components/workflow-loop/workflow-loop'
import { getBlock } from '@/blocks'
import { SubBlockConfig } from '@/blocks/types'

/**
 * Extended SubBlockConfig interface with optional value property
 * Extends the base SubBlockConfig to include the current value of the subblock
 */
interface ExtendedSubBlockConfig extends SubBlockConfig {
  value?: any
}

/**
 * WorkflowPreviewProps interface - defines the properties for the WorkflowPreview component
 */
interface WorkflowPreviewProps {
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
}

/**
 * Prepares subblocks by combining block state with block configuration
 * @param blockSubBlocks - The subblocks from the block state
 * @param blockConfig - The configuration for the block
 * @returns Array of prepared subblocks with values and configuration
 */
function prepareSubBlocks(blockSubBlocks: Record<string, any> = {}, blockConfig: any) {
  // Get the subBlocks from the block config
  const configSubBlocks = blockConfig?.subBlocks || []

  // Convert the subBlocks object to an array with proper structure
  return Object.entries(blockSubBlocks)
    .map(([id, subBlock]) => {
      // Find the matching config for this subBlock to get the title and other properties
      const matchingConfig = configSubBlocks.find((config: any) => config.id === id)

      // Skip if no value or value is null/undefined/empty string
      const value = subBlock.value
      const hasValue = value !== undefined && value !== null && value !== ''

      // Only include subblocks with values
      if (!hasValue) return null

      return {
        ...matchingConfig, // Include title and other properties from config
        ...subBlock, // Include value and other properties from state
        id, // Ensure id is included
      }
    })
    .filter(Boolean) // Filter out any undefined or null entries
}

/**
 * Groups subblocks into rows for layout
 * @param subBlocks - Array of subblocks to group
 * @returns 2D array of subblocks grouped into rows
 */
function groupSubBlocks(subBlocks: ExtendedSubBlockConfig[]) {
  const rows: ExtendedSubBlockConfig[][] = []
  let currentRow: ExtendedSubBlockConfig[] = []
  let currentRowWidth = 0

  // Filter visible blocks
  const visibleSubBlocks = subBlocks.filter((block) => !block.hidden)

  visibleSubBlocks.forEach((block) => {
    const blockWidth = block.layout === 'half' ? 0.5 : 1
    if (currentRowWidth + blockWidth > 1) {
      if (currentRow.length > 0) {
        rows.push([...currentRow])
      }
      currentRow = [block]
      currentRowWidth = blockWidth
    } else {
      currentRow.push(block)
      currentRowWidth += blockWidth
    }
  })

  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  return rows
}

/**
 * PreviewSubBlock component - Renders a simplified version of a subblock input
 * @param config - The configuration for the subblock
 */
function PreviewSubBlock({ config }: { config: ExtendedSubBlockConfig }) {
  /**
   * Renders a simplified input based on the subblock type
   * Creates visual representations of different input types
   */
  const renderSimplifiedInput = () => {
    switch (config.type) {
      case 'short-input':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            {config.value || config.placeholder || 'Text input'}
          </div>
        )
      case 'long-input':
        return (
          <div className="h-16 rounded-md border border-input bg-background p-2 text-xs text-muted-foreground">
            {typeof config.value === 'string'
              ? config.value.length > 50
                ? `${config.value.substring(0, 50)}...`
                : config.value
              : config.placeholder || 'Text area'}
          </div>
        )
      case 'dropdown':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              {config.value ||
                (Array.isArray(config.options) ? config.options[0] : 'Select option')}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ml-2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        )
      case 'switch':
        return (
          <div className="flex items-center space-x-2">
            <div
              className={`h-4 w-8 rounded-full ${config.value ? 'bg-primary' : 'bg-muted'} flex items-center`}
            >
              <div
                className={`h-3 w-3 rounded-full bg-background transition-all ${config.value ? 'ml-4' : 'ml-0.5'}`}
              ></div>
            </div>
            <span className="text-xs">{config.title}</span>
          </div>
        )
      case 'checkbox-list':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            Checkbox list
          </div>
        )
      case 'code':
        return (
          <div className="h-12 rounded-md border border-input bg-background p-2 text-xs font-mono text-muted-foreground">
            {typeof config.value === 'string'
              ? 'Code content'
              : config.placeholder || 'Code editor'}
          </div>
        )
      case 'tool-input':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            Tool configuration
          </div>
        )
      case 'slider':
        return (
          <div className="h-7 px-1 py-2">
            <div className="relative h-2 w-full rounded-full bg-muted">
              <div
                className="absolute h-2 rounded-full bg-primary"
                style={{ width: `${((config.value || 50) / 100) * 100}%` }}
              />
              <div
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background"
                style={{ left: `${((config.value || 50) / 100) * 100}%` }}
              />
            </div>
          </div>
        )
      default:
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            {config.value !== undefined ? String(config.value) : config.title || 'Input field'}
          </div>
        )
    }
  }

  return (
    <div className="space-y-1">
      {config.type !== 'switch' && <Label className="text-xs">{config.title}</Label>}
      {renderSimplifiedInput()}
    </div>
  )
}

/**
 * PreviewWorkflowBlock component - Simplified version of WorkflowBlock for preview
 * Renders a block with its subblocks in a card layout
 * @param id - The ID of the block
 * @param data - The data for the block
 */
function PreviewWorkflowBlock({ id, data }: NodeProps<any>) {
  const { type, config, name, blockState } = data

  // Prepare subblocks from block state and config
  const preparedSubBlocks = prepareSubBlocks(blockState?.subBlocks, config)

  // Group subblocks for layout
  const subBlockRows = groupSubBlocks(preparedSubBlocks)

  return (
    <div className="relative">
      <Card
        className={cn(
          'shadow-md select-none relative',
          'transition-ring transition-block-bg',
          blockState?.isWide ? 'w-[400px]' : 'w-[260px]'
        )}
      >
        {/* Block Header */}
        <div className="flex items-center justify-between p-2 border-b">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-6 h-6 rounded"
              style={{ backgroundColor: config.bgColor }}
            >
              <config.icon className="w-4 h-4 text-white" />
            </div>
            <span className="font-medium text-sm truncate max-w-[180px]" title={name}>
              {name}
            </span>
          </div>
        </div>

        {/* Block Content with SubBlocks */}
        <div className="px-3 py-2 space-y-2">
          {subBlockRows.length > 0 ? (
            subBlockRows.map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} className="flex gap-2">
                {row.map((subBlock, blockIndex) => (
                  <div
                    key={`${id}-${rowIndex}-${blockIndex}`}
                    className={cn('space-y-1', subBlock.layout === 'half' ? 'flex-1' : 'w-full')}
                  >
                    <PreviewSubBlock config={subBlock} />
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="text-xs text-muted-foreground py-2">No configured items</div>
          )}
        </div>

        {/* Input Handle - Don't show for starter blocks */}
        {type !== 'starter' && (
          <Handle
            type="target"
            position={blockState?.horizontalHandles ? Position.Left : Position.Top}
            id="target"
            className={cn(
              '!w-3 !h-3',
              '!bg-white !rounded-full !border !border-gray-200',
              blockState?.horizontalHandles ? '!left-[-6px]' : '!top-[-6px]'
            )}
            isConnectable={false}
          />
        )}

        {/* Output Handle */}
        {type !== 'condition' && (
          <Handle
            type="source"
            position={blockState?.horizontalHandles ? Position.Right : Position.Bottom}
            id="source"
            className={cn(
              '!w-3 !h-3',
              '!bg-white !rounded-full !border !border-gray-200',
              blockState?.horizontalHandles ? '!right-[-6px]' : '!bottom-[-6px]'
            )}
            isConnectable={false}
          />
        )}
      </Card>
    </div>
  )
}

// Define node types and edge types for ReactFlow
const nodeTypes: NodeTypes = {
  workflowBlock: PreviewWorkflowBlock,
  loopLabel: LoopLabel,
  loopInput: LoopInput,
}

const edgeTypes: EdgeTypes = { workflowEdge: WorkflowEdge }

/**
 * WorkflowPreviewContent component - Inner content of the workflow preview
 * Handles the transformation of workflow state into ReactFlow nodes and edges
 * @param workflowState - The state of the workflow to preview
 */
function WorkflowPreviewContent({ workflowState }: WorkflowPreviewProps) {
  // Transform blocks into ReactFlow nodes
  const nodes: Node[] = useMemo(() => {
    const nodeArray: Node[] = []

    // Add block nodes
    Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
      // Get block configuration from registry
      const blockConfig = getBlock(block.type)
      if (!blockConfig) return

      // Create node
      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: block.position,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          blockState: block, // Pass the entire block state
        },
        draggable: false,
      })
    })

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

    return nodeArray
  }, [workflowState.blocks, workflowState.loops])

  // Transform edges into ReactFlow edges
  const edges: Edge[] = useMemo(() => {
    return workflowState.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'workflowEdge',
      data: {
        // No edge deletion in preview mode
        onDelete: undefined,
        selectedEdgeId: null,
      },
    }))
  }, [workflowState.edges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{
        padding: 0,
        minZoom: 0.2,
        maxZoom: 3,
      }}
      minZoom={0.2}
      maxZoom={3}
      defaultEdgeOptions={{ type: 'workflowEdge' }}
      proOptions={{ hideAttribution: true }}
      connectionLineType={ConnectionLineType.SmoothStep}
      connectionLineStyle={{
        stroke: '#94a3b8',
        strokeWidth: 1,
        strokeDasharray: '3,3',
      }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      panOnDrag={false}
      preventScrolling={false}
      disableKeyboardA11y={true}
      attributionPosition="bottom-right"
      className="w-full h-full pointer-events-none"
      style={{ background: 'transparent', pointerEvents: 'none' }}
    >
      <Background gap={12} size={1} className="opacity-30 pointer-events-none" />
    </ReactFlow>
  )
}

/**
 * WorkflowPreview component - Main exported component for workflow preview
 * Wraps the preview content in a ReactFlowProvider
 * @param workflowState - The state of the workflow to preview
 */
export function WorkflowPreview({ workflowState }: WorkflowPreviewProps) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full -m-1">
        <WorkflowPreviewContent workflowState={workflowState} />
      </div>
    </ReactFlowProvider>
  )
}
