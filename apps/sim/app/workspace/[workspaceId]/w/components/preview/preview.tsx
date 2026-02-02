'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { cn } from '@/lib/core/utils/cn'
import { PreviewEditor } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-editor'
import {
  getLeftmostBlockId,
  PreviewWorkflow,
} from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface TraceSpan {
  blockId?: string
  input?: unknown
  output?: unknown
  status?: string
  duration?: number
  children?: TraceSpan[]
  childWorkflowSnapshotId?: string
  childWorkflowId?: string
}

interface BlockExecutionData {
  input: unknown
  output: unknown
  status: string
  durationMs: number
  /** Child trace spans for nested workflow blocks */
  children?: TraceSpan[]
  childWorkflowSnapshotId?: string
}

/** Represents a level in the workflow navigation stack */
interface WorkflowStackEntry {
  workflowState: WorkflowState
  traceSpans: TraceSpan[]
  blockExecutions: Record<string, BlockExecutionData>
  workflowName: string
}

/**
 * Extracts child trace spans from a workflow block's execution data.
 * Checks `children` property (where trace-spans processing puts them),
 * with fallback to `output.childTraceSpans` for old stored logs.
 */
function extractChildTraceSpans(blockExecution: BlockExecutionData | undefined): TraceSpan[] {
  if (!blockExecution) return []

  if (Array.isArray(blockExecution.children) && blockExecution.children.length > 0) {
    return blockExecution.children
  }

  // Backward compat: old stored logs may have childTraceSpans in output
  if (blockExecution.output && typeof blockExecution.output === 'object') {
    const output = blockExecution.output as Record<string, unknown>
    if (Array.isArray(output.childTraceSpans)) {
      return output.childTraceSpans as TraceSpan[]
    }
  }

  return []
}

/**
 * Builds block execution data from trace spans
 */
export function buildBlockExecutions(spans: TraceSpan[]): Record<string, BlockExecutionData> {
  const blockExecutionMap: Record<string, BlockExecutionData> = {}

  const collectBlockSpans = (traceSpans: TraceSpan[]): TraceSpan[] => {
    const blockSpans: TraceSpan[] = []
    for (const span of traceSpans) {
      if (span.blockId) {
        blockSpans.push(span)
      }
      if (span.children && Array.isArray(span.children)) {
        blockSpans.push(...collectBlockSpans(span.children))
      }
    }
    return blockSpans
  }

  const allBlockSpans = collectBlockSpans(spans)

  for (const span of allBlockSpans) {
    if (span.blockId && !blockExecutionMap[span.blockId]) {
      blockExecutionMap[span.blockId] = {
        input: redactApiKeys(span.input || {}),
        output: redactApiKeys(span.output || {}),
        status: span.status || 'unknown',
        durationMs: span.duration || 0,
        children: span.children,
        childWorkflowSnapshotId: span.childWorkflowSnapshotId,
      }
    }
  }

  return blockExecutionMap
}

interface PreviewProps {
  /** The workflow state to display */
  workflowState: WorkflowState
  /** Trace spans for the execution (optional - enables execution mode features) */
  traceSpans?: TraceSpan[]
  /** Pre-computed block executions (optional - will be built from traceSpans if not provided) */
  blockExecutions?: Record<string, BlockExecutionData>
  /** Child workflow snapshots keyed by snapshot ID (execution mode only) */
  childWorkflowSnapshots?: Record<string, WorkflowState>
  /** Additional CSS class names */
  className?: string
  /** Height of the component */
  height?: string | number
  /** Width of the component */
  width?: string | number
  /** Callback when canvas context menu is opened */
  onCanvasContextMenu?: (e: React.MouseEvent) => void
  /** Callback when a node context menu is opened */
  onNodeContextMenu?: (blockId: string, mousePosition: { x: number; y: number }) => void
  /** Whether to show border around the component */
  showBorder?: boolean
  /** Initial block to select (defaults to leftmost block) */
  initialSelectedBlockId?: string | null
  /** Whether to auto-select the leftmost block on mount */
  autoSelectLeftmost?: boolean
}

/**
 * Main preview component that combines PreviewCanvas with PreviewEditor
 * and handles nested workflow navigation via a stack.
 *
 * @remarks
 * - Manages navigation stack for drilling into nested workflow blocks
 * - Displays back button when viewing nested workflows
 * - Properly passes execution data through to nested levels
 * - Can be used anywhere a workflow preview with editor is needed
 */
export function Preview({
  workflowState: rootWorkflowState,
  traceSpans: rootTraceSpans,
  blockExecutions: providedBlockExecutions,
  childWorkflowSnapshots,
  className,
  height = '100%',
  width = '100%',
  onCanvasContextMenu,
  onNodeContextMenu,
  showBorder = false,
  initialSelectedBlockId,
  autoSelectLeftmost = true,
}: PreviewProps) {
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(() => {
    if (initialSelectedBlockId) return initialSelectedBlockId
    if (autoSelectLeftmost) {
      return getLeftmostBlockId(rootWorkflowState)
    }
    return null
  })

  const [workflowStack, setWorkflowStack] = useState<WorkflowStackEntry[]>([])

  const rootBlockExecutions = useMemo(() => {
    if (providedBlockExecutions) return providedBlockExecutions
    if (!rootTraceSpans || !Array.isArray(rootTraceSpans)) return {}
    return buildBlockExecutions(rootTraceSpans)
  }, [providedBlockExecutions, rootTraceSpans])

  const blockExecutions = useMemo(() => {
    if (workflowStack.length > 0) {
      return workflowStack[workflowStack.length - 1].blockExecutions
    }
    return rootBlockExecutions
  }, [workflowStack, rootBlockExecutions])

  const workflowState = useMemo(() => {
    if (workflowStack.length > 0) {
      return workflowStack[workflowStack.length - 1].workflowState
    }
    return rootWorkflowState
  }, [workflowStack, rootWorkflowState])

  const isExecutionMode = useMemo(() => {
    return Object.keys(blockExecutions).length > 0
  }, [blockExecutions])

  const handleDrillDown = useCallback(
    (blockId: string, childWorkflowState: WorkflowState) => {
      const blockExecution = blockExecutions[blockId]
      const childTraceSpans = extractChildTraceSpans(blockExecution)
      const childBlockExecutions = buildBlockExecutions(childTraceSpans)

      const workflowName = childWorkflowState.metadata?.name || 'Nested Workflow'

      setWorkflowStack((prev) => [
        ...prev,
        {
          workflowState: childWorkflowState,
          traceSpans: childTraceSpans,
          blockExecutions: childBlockExecutions,
          workflowName,
        },
      ])

      const leftmostId = getLeftmostBlockId(childWorkflowState)
      setPinnedBlockId(leftmostId)
    },
    [blockExecutions]
  )

  const handleGoBack = useCallback(() => {
    setWorkflowStack((prev) => prev.slice(0, -1))
    setPinnedBlockId(null)
  }, [])

  const handleNodeClick = useCallback((blockId: string) => {
    setPinnedBlockId(blockId)
  }, [])

  const handlePaneClick = useCallback(() => {
    setPinnedBlockId(null)
  }, [])

  const handleEditorClose = useCallback(() => {
    setPinnedBlockId(null)
  }, [])

  useEffect(() => {
    setWorkflowStack([])
  }, [rootWorkflowState])

  const isNested = workflowStack.length > 0

  const currentWorkflowName = isNested ? workflowStack[workflowStack.length - 1].workflowName : null

  return (
    <div
      style={{ height, width }}
      className={cn(
        'relative flex overflow-hidden',
        showBorder && 'rounded-[4px] border border-[var(--border)]',
        className
      )}
    >
      {isNested && (
        <div className='absolute top-[12px] left-[12px] z-20 flex items-center gap-[6px]'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={handleGoBack}
                className='flex h-[28px] items-center gap-[5px] rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-[10px] text-[var(--text-secondary)] shadow-sm hover:bg-[var(--surface-4)] hover:text-[var(--text-primary)]'
              >
                <ArrowLeft className='h-[12px] w-[12px]' />
                <span className='font-medium text-[12px]'>Back</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='bottom'>Go back to parent workflow</Tooltip.Content>
          </Tooltip.Root>
          {currentWorkflowName && (
            <div className='flex h-[28px] max-w-[200px] items-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-[10px] shadow-sm'>
              <span className='truncate font-medium text-[12px] text-[var(--text-secondary)]'>
                {currentWorkflowName}
              </span>
            </div>
          )}
        </div>
      )}

      <div className='h-full flex-1' onContextMenu={onCanvasContextMenu}>
        <PreviewWorkflow
          workflowState={workflowState}
          isPannable={true}
          defaultPosition={{ x: 0, y: 0 }}
          defaultZoom={0.8}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={handlePaneClick}
          cursorStyle='pointer'
          executedBlocks={blockExecutions}
          selectedBlockId={pinnedBlockId}
        />
      </div>

      {pinnedBlockId && workflowState.blocks[pinnedBlockId] && (
        <PreviewEditor
          block={workflowState.blocks[pinnedBlockId]}
          executionData={blockExecutions[pinnedBlockId]}
          allBlockExecutions={blockExecutions}
          workflowBlocks={workflowState.blocks}
          workflowVariables={workflowState.variables}
          loops={workflowState.loops}
          parallels={workflowState.parallels}
          isExecutionMode={isExecutionMode}
          childWorkflowSnapshots={childWorkflowSnapshots}
          onClose={handleEditorClose}
          onDrillDown={handleDrillDown}
        />
      )}
    </div>
  )
}
