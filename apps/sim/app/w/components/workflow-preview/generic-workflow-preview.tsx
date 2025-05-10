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

interface ExtendedSubBlockConfig extends SubBlockConfig {
  value?: any
}

// Define node types
const nodeTypes: NodeTypes = {
  workflowBlock: PreviewWorkflowBlock,
  loopLabel: LoopLabel,
  loopInput: LoopInput,
}

// Define edge types
const edgeTypes: EdgeTypes = {
  workflowEdge: WorkflowEdge,
}

/**
 * Prepares subblocks by combining block state with block configuration
 */
function prepareSubBlocks(blockSubBlocks: Record<string, any> = {}, blockConfig: any) {
  const configSubBlocks = blockConfig?.subBlocks || []

  return Object.entries(blockSubBlocks)
    .map(([id, subBlock]) => {
      const matchingConfig = configSubBlocks.find((config: any) => config.id === id)

      const value = subBlock.value
      const hasValue = value !== undefined && value !== null && value !== ''

      if (!hasValue) return null

      return {
        ...matchingConfig,
        ...subBlock,
        id,
      }
    })
    .filter(Boolean)
}

/**
 * Groups subblocks into rows for layout
 */
function groupSubBlocks(subBlocks: ExtendedSubBlockConfig[]) {
  const rows: ExtendedSubBlockConfig[][] = []
  let currentRow: ExtendedSubBlockConfig[] = []
  let currentRowWidth = 0

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
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground">
            {config.password
              ? '**********************'
              : config.id === 'providerConfig' && config.value && typeof config.value === 'object'
                ? Object.keys(config.value).length === 0
                  ? 'Webhook pending configuration'
                  : 'Webhook configured'
                : config.value || config.placeholder || 'Text input'}
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
      case 'oauth-input':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              {config.value ? 'Connected account' : config.placeholder || 'Select account'}
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
      case 'file-selector':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>{config.value ? 'File selected' : config.placeholder || 'Select file'}</span>
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
      case 'folder-selector':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>{config.value ? 'Folder selected' : config.placeholder || 'Select folder'}</span>
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
      case 'project-selector':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              {config.value ? 'Project selected' : config.placeholder || 'Select project'}
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
      case 'condition-input':
        return (
          <div className="h-16 rounded-md border border-input bg-background p-2 text-xs text-muted-foreground">
            Condition configuration
          </div>
        )
      case 'eval-input':
        return (
          <div className="h-12 rounded-md border border-input bg-background p-2 text-xs font-mono text-muted-foreground">
            Eval expression
          </div>
        )
      case 'date-input':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>{config.value || config.placeholder || 'Select date'}</span>
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
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
              <line x1="16" x2="16" y1="2" y2="6" />
              <line x1="8" x2="8" y1="2" y2="6" />
              <line x1="3" x2="21" y1="10" y2="10" />
            </svg>
          </div>
        )
      case 'time-input':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-between">
            <span>{config.value || config.placeholder || 'Select time'}</span>
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
        )
      case 'file-upload':
        return (
          <div className="h-7 rounded-md border border-dashed border-input bg-background px-3 py-1 text-xs text-muted-foreground flex items-center justify-center">
            {config.value ? 'File uploaded' : 'Upload file'}
          </div>
        )
      case 'webhook-config':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            Webhook configuration
          </div>
        )
      case 'schedule-config':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            Schedule configuration
          </div>
        )
      case 'input-format':
        return (
          <div className="h-7 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground">
            Input format configuration
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

function PreviewWorkflowBlock({ id, data }: NodeProps<any>) {
  const { type, config, name, blockState, showSubBlocks = true } = data

  // Only prepare subblocks if they should be shown
  const preparedSubBlocks = useMemo(() => {
    if (!showSubBlocks) return []
    return prepareSubBlocks(blockState?.subBlocks, config)
  }, [blockState?.subBlocks, config, showSubBlocks])

  // Group subblocks for layout
  const subBlockRows = useMemo(() => {
    return groupSubBlocks(preparedSubBlocks)
  }, [preparedSubBlocks])

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

        {/* Block Content */}
        {showSubBlocks && (
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
        )}

        {/* Handles */}
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

function WorkflowPreviewContent({
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

    // Add block nodes
    Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
      const blockConfig = getBlock(block.type)
      if (!blockConfig) return

      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: block.position,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          blockState: block,
          showSubBlocks,
        },
        draggable: false,
      })
    })

    return nodeArray
  }, [workflowState.blocks, workflowState.loops, showSubBlocks])

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
  }, [workflowState.edges])

  return (
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
      >
        <Background />
      </ReactFlow>
    </div>
  )
}

export function WorkflowPreview(props: WorkflowPreviewProps) {
  return (
    <ReactFlowProvider>
      <WorkflowPreviewContent {...props} />
    </ReactFlowProvider>
  )
}
