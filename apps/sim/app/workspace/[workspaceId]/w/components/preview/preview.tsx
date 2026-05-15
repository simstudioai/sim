'use client'

import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  /** Whether to show the close (X) button on the block detail panel */
  showBlockCloseButton?: boolean
}

const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 600
const DEFAULT_PANEL_WIDTH = 320

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
  showBlockCloseButton = true,
}: PreviewProps) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const panelWidthRef = useRef(DEFAULT_PANEL_WIDTH)
  panelWidthRef.current = panelWidth
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  function handleResizeMouseDown(e: React.MouseEvent) {
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = panelWidthRef.current
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = startXRef.current - e.clientX
      setPanelWidth(
        Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, startWidthRef.current + delta))
      )
    }
    const handleMouseUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(() => {
    if (initialSelectedBlockId) return initialSelectedBlockId
    if (autoSelectLeftmost) {
      return getLeftmostBlockId(rootWorkflowState)
    }
    return null
  })

  const [workflowStack, setWorkflowStack] = useState<WorkflowStackEntry[]>([])
  const [prevRootState, setPrevRootState] = useState(rootWorkflowState)
  if (rootWorkflowState !== prevRootState) {
    setPrevRootState(rootWorkflowState)
    setWorkflowStack([])
  }

  const rootBlockExecutions = useMemo(() => {
    if (providedBlockExecutions) return providedBlockExecutions
    if (!rootTraceSpans || !Array.isArray(rootTraceSpans)) return {}
    return buildBlockExecutions(rootTraceSpans)
  }, [providedBlockExecutions, rootTraceSpans])

  const currentStackEntry =
    workflowStack.length > 0 ? workflowStack[workflowStack.length - 1] : null
  const blockExecutions = currentStackEntry
    ? currentStackEntry.blockExecutions
    : rootBlockExecutions
  const workflowState = currentStackEntry ? currentStackEntry.workflowState : rootWorkflowState

  const isExecutionMode = Object.keys(blockExecutions).length > 0

  function handleDrillDown(blockId: string, childWorkflowState: WorkflowState) {
    const blockExecution = blockExecutions[blockId]
    const childTraceSpans = extractChildTraceSpans(blockExecution)
    const childBlockExecutions = buildBlockExecutions(childTraceSpans)

    const workflowName =
      childWorkflowState.metadata?.name ||
      (blockExecution?.output as { childWorkflowName?: string } | undefined)?.childWorkflowName ||
      'Nested Workflow'

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
  }

  function handleGoBack() {
    setWorkflowStack((prev) => prev.slice(0, -1))
    setPinnedBlockId(null)
  }

  function handleNodeClick(blockId: string) {
    setPinnedBlockId(blockId)
  }

  function handlePaneClick() {
    setPinnedBlockId(null)
  }

  function handleEditorClose() {
    setPinnedBlockId(null)
  }

  const isNested = workflowStack.length > 0

  const currentWorkflowName = isNested ? workflowStack[workflowStack.length - 1].workflowName : null

  return (
    <div
      style={{ height, width }}
      className={cn(
        'relative flex overflow-hidden',
        showBorder && 'rounded-sm border border-[var(--border)]',
        className
      )}
    >
      {isNested && (
        <div className='absolute top-3 left-[12px] z-20 flex items-center gap-1.5'>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={handleGoBack}
                className='flex h-[28px] items-center gap-[5px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[var(--text-secondary)] shadow-sm hover-hover:bg-[var(--surface-4)] hover-hover:text-[var(--text-primary)]'
              >
                <ArrowLeft className='size-[12px]' />
                <span className='font-medium text-caption'>Back</span>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='bottom'>Go back to parent workflow</Tooltip.Content>
          </Tooltip.Root>
          {currentWorkflowName && (
            <div className='flex h-[28px] max-w-[200px] items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 shadow-sm'>
              <span className='truncate font-medium text-[var(--text-secondary)] text-caption'>
                {currentWorkflowName}
              </span>
            </div>
          )}
        </div>
      )}

      <div role='presentation' className='h-full flex-1' onContextMenu={onCanvasContextMenu}>
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
        <div style={{ width: panelWidth }} className='relative h-full flex-shrink-0'>
          {/* Left-edge resize handle */}
          <div
            role='separator'
            aria-orientation='vertical'
            className='absolute top-0 bottom-0 left-0 z-10 w-1 cursor-ew-resize transition-colors hover-hover:bg-[var(--border-1)]'
            onMouseDown={handleResizeMouseDown}
          />
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
            onClose={showBlockCloseButton ? handleEditorClose : undefined}
            onDrillDown={handleDrillDown}
          />
        </div>
      )}
    </div>
  )
}
