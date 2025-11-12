'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  DollarSign,
  Hash,
  Loader2,
  Maximize2,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console/logger'
import { cn, redactApiKeys } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('FrozenCanvas')

function ExpandableDataSection({ title, data }: { title: string; data: any }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const jsonString = JSON.stringify(data, null, 2)
  const isLargeData = jsonString.length > 500 || jsonString.split('\n').length > 10

  return (
    <>
      <div>
        <div className='mb-[8px] flex items-center justify-between'>
          <h4 className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
            {title}
          </h4>
          <div className='flex items-center gap-[4px]'>
            {isLargeData && (
              <button
                onClick={() => setIsModalOpen(true)}
                className='p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)] dark:hover:text-[var(--text-primary)]'
                title='Expand in modal'
              >
                <Maximize2 className='h-[12px] w-[12px]' />
              </button>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)] dark:hover:text-[var(--text-primary)]'
            >
              {isExpanded ? (
                <ChevronUp className='h-[12px] w-[12px]' />
              ) : (
                <ChevronDown className='h-[12px] w-[12px]' />
              )}
            </button>
          </div>
        </div>
        <div
          className={cn(
            'overflow-y-auto bg-[var(--surface-5)] p-[12px] font-mono text-[12px] transition-all duration-200',
            isExpanded ? 'max-h-96' : 'max-h-32'
          )}
        >
          <pre className='whitespace-pre-wrap break-words text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
            {jsonString}
          </pre>
        </div>
      </div>

      {/* Modal for large data */}
      {isModalOpen && (
        <div className='fixed inset-0 z-[200] flex items-center justify-center bg-black/50'>
          <div className='mx-[16px] h-[80vh] w-full max-w-4xl border bg-[var(--surface-1)] shadow-lg dark:border-[var(--border)] dark:bg-[var(--surface-1)]'>
            <div className='flex items-center justify-between border-b p-[16px] dark:border-[var(--border)]'>
              <h3 className='font-medium text-[15px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                {title}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className='p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)] dark:hover:text-[var(--text-primary)]'
              >
                <X className='h-[14px] w-[14px]' />
              </button>
            </div>
            <div className='h-[calc(80vh-4rem)] overflow-auto p-[16px]'>
              <pre className='whitespace-pre-wrap break-words font-mono text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                {jsonString}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function formatExecutionData(executionData: any) {
  const {
    inputData,
    outputData,
    cost,
    tokens,
    durationMs,
    status,
    blockName,
    blockType,
    errorMessage,
    errorStackTrace,
  } = executionData

  return {
    blockName: blockName || 'Unknown Block',
    blockType: blockType || 'unknown',
    status,
    duration: durationMs ? `${durationMs}ms` : 'N/A',
    input: redactApiKeys(inputData || {}),
    output: redactApiKeys(outputData || {}),
    errorMessage,
    errorStackTrace,
    cost: cost
      ? {
          input: cost.input || 0,
          output: cost.output || 0,
          total: cost.total || 0,
        }
      : null,
    tokens: tokens
      ? {
          prompt: tokens.prompt || 0,
          completion: tokens.completion || 0,
          total: tokens.total || 0,
        }
      : null,
  }
}

function getCurrentIterationData(blockExecutionData: any) {
  if (blockExecutionData.iterations && Array.isArray(blockExecutionData.iterations)) {
    const currentIndex = blockExecutionData.currentIteration ?? 0
    return {
      executionData: blockExecutionData.iterations[currentIndex],
      currentIteration: currentIndex,
      totalIterations: blockExecutionData.totalIterations ?? blockExecutionData.iterations.length,
      hasMultipleIterations: blockExecutionData.iterations.length > 1,
    }
  }

  return {
    executionData: blockExecutionData,
    currentIteration: 0,
    totalIterations: 1,
    hasMultipleIterations: false,
  }
}

function PinnedLogs({
  executionData,
  blockId,
  workflowState,
  onClose,
}: {
  executionData: any | null
  blockId: string
  workflowState: any
  onClose: () => void
}) {
  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  const [currentIterationIndex, setCurrentIterationIndex] = useState(0)

  // Reset iteration index when execution data changes
  useEffect(() => {
    setCurrentIterationIndex(0)
  }, [executionData])

  // Handle case where block has no execution data (e.g., failed workflow)
  if (!executionData) {
    const blockInfo = workflowState?.blocks?.[blockId]
    const formatted = {
      blockName: blockInfo?.name || 'Unknown Block',
      blockType: blockInfo?.type || 'unknown',
      status: 'not_executed',
      duration: 'N/A',
      input: null,
      output: null,
      errorMessage: null,
      errorStackTrace: null,
      cost: null,
      tokens: null,
    }

    return (
      <Card className='fixed top-[16px] right-[16px] z-[100] max-h-[calc(100vh-8rem)] w-96 overflow-y-auto border bg-[var(--surface-1)] shadow-lg dark:border-[var(--border)] dark:bg-[var(--surface-1)]'>
        <CardHeader className='pb-[12px]'>
          <div className='flex items-center justify-between'>
            <CardTitle className='flex items-center gap-[8px] text-[15px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              <Zap className='h-[16px] w-[16px]' />
              {formatted.blockName}
            </CardTitle>
            <button
              onClick={onClose}
              className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)]'
            >
              <X className='h-[14px] w-[14px]' />
            </button>
          </div>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-[8px]'>
              <Badge variant='secondary'>{formatted.blockType}</Badge>
              <Badge variant='outline'>not executed</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className='space-y-[16px]'>
          <div className='bg-[var(--surface-5)] p-[16px] text-center'>
            <div className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
              This block was not executed because the workflow failed before reaching it.
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Now we can safely use the execution data
  const iterationInfo = getCurrentIterationData({
    ...executionData,
    currentIteration: currentIterationIndex,
  })

  const formatted = formatExecutionData(iterationInfo.executionData)
  const totalIterations = executionData.iterations?.length || 1

  const goToPreviousIteration = () => {
    if (currentIterationIndex > 0) {
      setCurrentIterationIndex(currentIterationIndex - 1)
    }
  }

  const goToNextIteration = () => {
    if (currentIterationIndex < totalIterations - 1) {
      setCurrentIterationIndex(currentIterationIndex + 1)
    }
  }

  return (
    <Card className='fixed top-[16px] right-[16px] z-[100] max-h-[calc(100vh-8rem)] w-96 overflow-y-auto rounded-[14px] border bg-[var(--surface-1)] shadow-lg dark:border-[var(--border)] dark:bg-[var(--surface-1)]'>
      <CardHeader className='pb-[12px]'>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center gap-[8px] text-[15px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
            <Zap className='h-[16px] w-[16px]' />
            {formatted.blockName}
          </CardTitle>
          <button
            onClick={onClose}
            className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)]'
          >
            <X className='h-[14px] w-[14px]' />
          </button>
        </div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Badge variant={formatted.status === 'success' ? 'default' : 'destructive'}>
              {formatted.blockType}
            </Badge>
            <Badge variant='outline'>{formatted.status}</Badge>
          </div>

          {/* Iteration Navigation */}
          {iterationInfo.hasMultipleIterations && (
            <div className='flex items-center gap-[4px]'>
              <button
                onClick={goToPreviousIteration}
                disabled={currentIterationIndex === 0}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)] dark:hover:text-[var(--text-primary)]'
              >
                <ChevronLeft className='h-[14px] w-[14px]' />
              </button>
              <span className='px-[8px] text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                {iterationInfo.totalIterations !== undefined
                  ? `${currentIterationIndex + 1} / ${iterationInfo.totalIterations}`
                  : `${currentIterationIndex + 1}`}
              </span>
              <button
                onClick={goToNextIteration}
                disabled={currentIterationIndex === totalIterations - 1}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-secondary)] dark:hover:bg-[var(--border)] dark:hover:text-[var(--text-primary)]'
              >
                <ChevronRight className='h-[14px] w-[14px]' />
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className='space-y-[16px]'>
        <div className='grid grid-cols-2 gap-[16px]'>
          <div className='flex items-center gap-[8px]'>
            <Clock className='h-[14px] w-[14px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' />
            <span className='text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              {formatted.duration}
            </span>
          </div>

          {formatted.cost && formatted.cost.total > 0 && (
            <div className='flex items-center gap-[8px]'>
              <DollarSign className='h-[14px] w-[14px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' />
              <span className='text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                ${formatted.cost.total.toFixed(5)}
              </span>
            </div>
          )}

          {formatted.tokens && formatted.tokens.total > 0 && (
            <div className='flex items-center gap-[8px]'>
              <Hash className='h-[14px] w-[14px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' />
              <span className='text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                {formatted.tokens.total} tokens
              </span>
            </div>
          )}
        </div>

        <ExpandableDataSection title='Input' data={formatted.input} />

        <ExpandableDataSection title='Output' data={formatted.output} />

        {formatted.cost && formatted.cost.total > 0 && (
          <div>
            <h4 className='mb-[8px] font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Cost Breakdown
            </h4>
            <div className='space-y-[4px] text-[13px]'>
              <div className='flex justify-between text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                <span>Input:</span>
                <span>${formatted.cost.input.toFixed(5)}</span>
              </div>
              <div className='flex justify-between text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                <span>Output:</span>
                <span>${formatted.cost.output.toFixed(5)}</span>
              </div>
              <div className='flex justify-between border-t pt-[4px] font-medium text-[var(--text-primary)] dark:border-[var(--border)] dark:text-[var(--text-primary)]'>
                <span>Total:</span>
                <span>${formatted.cost.total.toFixed(5)}</span>
              </div>
            </div>
          </div>
        )}

        {formatted.tokens && formatted.tokens.total > 0 && (
          <div>
            <h4 className='mb-[8px] font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Token Usage
            </h4>
            <div className='space-y-[4px] text-[13px]'>
              <div className='flex justify-between text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                <span>Prompt:</span>
                <span>{formatted.tokens.prompt}</span>
              </div>
              <div className='flex justify-between text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                <span>Completion:</span>
                <span>{formatted.tokens.completion}</span>
              </div>
              <div className='flex justify-between border-t pt-[4px] font-medium text-[var(--text-primary)] dark:border-[var(--border)] dark:text-[var(--text-primary)]'>
                <span>Total:</span>
                <span>{formatted.tokens.total}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface FrozenCanvasData {
  executionId: string
  workflowId: string
  workflowState: WorkflowState
  executionMetadata: {
    trigger: string
    startedAt: string
    endedAt?: string
    totalDurationMs?: number

    cost: {
      total: number | null
      input: number | null
      output: number | null
    }
    totalTokens: number | null
  }
}

interface FrozenCanvasProps {
  executionId: string
  traceSpans?: any[]
  className?: string
  height?: string | number
  width?: string | number
}

export function FrozenCanvas({
  executionId,
  traceSpans,
  className,
  height = '100%',
  width = '100%',
}: FrozenCanvasProps) {
  const [data, setData] = useState<FrozenCanvasData | null>(null)
  const [blockExecutions, setBlockExecutions] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null)

  // Process traceSpans to create blockExecutions map
  useEffect(() => {
    if (traceSpans && Array.isArray(traceSpans)) {
      const blockExecutionMap: Record<string, any> = {}

      logger.debug('Processing trace spans for frozen canvas:', { traceSpans })

      // Recursively collect all spans with blockId from the trace spans tree
      const collectBlockSpans = (spans: any[]): any[] => {
        const blockSpans: any[] = []

        for (const span of spans) {
          // If this span has a blockId, it's a block execution
          if (span.blockId) {
            blockSpans.push(span)
          }

          // Recursively check children
          if (span.children && Array.isArray(span.children)) {
            blockSpans.push(...collectBlockSpans(span.children))
          }
        }

        return blockSpans
      }

      const allBlockSpans = collectBlockSpans(traceSpans)
      logger.debug('Collected all block spans:', allBlockSpans)

      // Group spans by blockId
      const traceSpansByBlockId = allBlockSpans.reduce((acc: any, span: any) => {
        if (span.blockId) {
          if (!acc[span.blockId]) {
            acc[span.blockId] = []
          }
          acc[span.blockId].push(span)
        }
        return acc
      }, {})

      logger.debug('Grouped trace spans by blockId:', traceSpansByBlockId)

      for (const [blockId, spans] of Object.entries(traceSpansByBlockId)) {
        const spanArray = spans as any[]

        const iterations = spanArray.map((span: any) => {
          // Extract error information from span output if status is error
          let errorMessage = null
          let errorStackTrace = null

          if (span.status === 'error' && span.output) {
            // Error information can be in different formats in the output
            if (typeof span.output === 'string') {
              errorMessage = span.output
            } else if (span.output.error) {
              errorMessage = span.output.error
              errorStackTrace = span.output.stackTrace || span.output.stack
            } else if (span.output.message) {
              errorMessage = span.output.message
              errorStackTrace = span.output.stackTrace || span.output.stack
            } else {
              // Fallback: stringify the entire output for error cases
              errorMessage = JSON.stringify(span.output)
            }
          }

          return {
            id: span.id,
            blockId: span.blockId,
            blockName: span.name,
            blockType: span.type,
            status: span.status,
            startedAt: span.startTime,
            endedAt: span.endTime,
            durationMs: span.duration,
            inputData: span.input,
            outputData: span.output,
            errorMessage,
            errorStackTrace,
            cost: span.cost || {
              input: null,
              output: null,
              total: null,
            },
            tokens: span.tokens || {
              prompt: null,
              completion: null,
              total: null,
            },
            modelUsed: span.model || null,
            metadata: {},
          }
        })

        blockExecutionMap[blockId] = {
          iterations,
          currentIteration: 0,
          totalIterations: iterations.length,
        }
      }

      setBlockExecutions(blockExecutionMap)
    }
  }, [traceSpans])

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/logs/execution/${executionId}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch frozen canvas data: ${response.statusText}`)
        }

        const result = await response.json()
        setData(result)
        logger.debug(`Loaded frozen canvas data for execution: ${executionId}`)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Failed to fetch frozen canvas data:', err)
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [executionId])

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='flex items-center gap-[8px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
          <Loader2 className='h-[16px] w-[16px] animate-spin' />
          <span className='text-[13px]'>Loading frozen canvas...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='flex items-center gap-[8px] text-[var(--text-error)] dark:text-[var(--text-error)]'>
          <AlertCircle className='h-[16px] w-[16px]' />
          <span className='text-[13px]'>Failed to load frozen canvas: {error}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
          No data available
        </div>
      </div>
    )
  }

  // Check if this is a migrated log without real workflow state
  const isMigratedLog = (data.workflowState as any)?._migrated === true
  if (isMigratedLog) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-[16px] p-[32px]', className)}
        style={{ height, width }}
      >
        <div className='flex items-center gap-[12px] text-amber-600 dark:text-amber-400'>
          <AlertCircle className='h-[20px] w-[20px]' />
          <span className='font-medium text-[15px]'>Logged State Not Found</span>
        </div>
        <div className='max-w-md text-center text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
          This log was migrated from the old logging system. The workflow state at execution time is
          not available.
        </div>
        <div className='text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
          Note: {(data.workflowState as any)?._note}
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ height, width }} className={cn('frozen-canvas-mode h-full w-full', className)}>
        <WorkflowPreview
          workflowState={data.workflowState}
          showSubBlocks={true}
          isPannable={true}
          defaultZoom={0.8}
          fitPadding={0.25}
          onNodeClick={(blockId) => {
            // Always allow clicking blocks, even if they don't have execution data
            // This is important for failed workflows where some blocks never executed
            setPinnedBlockId(blockId)
          }}
        />
      </div>

      {pinnedBlockId && (
        <PinnedLogs
          executionData={blockExecutions[pinnedBlockId] || null}
          blockId={pinnedBlockId}
          workflowState={data.workflowState}
          onClose={() => setPinnedBlockId(null)}
        />
      )}
    </>
  )
}
