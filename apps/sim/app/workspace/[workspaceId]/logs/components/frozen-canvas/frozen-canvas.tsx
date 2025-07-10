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
import { createLogger } from '@/lib/logs/console-logger'
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
        <div className='mb-2 flex items-center justify-between'>
          <h4 className='font-medium text-foreground text-sm'>{title}</h4>
          <div className='flex items-center gap-1'>
            {isLargeData && (
              <button
                onClick={() => setIsModalOpen(true)}
                className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
                title="Expand in modal"
              >
                <Maximize2 className='h-3 w-3' />
              </button>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
            >
              {isExpanded ? <ChevronUp className='h-3 w-3' /> : <ChevronDown className='h-3 w-3' />}
            </button>
          </div>
        </div>
        <div
          className={cn(
            'overflow-y-auto rounded bg-muted p-3 font-mono text-xs transition-all duration-200',
            isExpanded ? 'max-h-96' : 'max-h-32'
          )}
        >
          <pre className='whitespace-pre-wrap break-words text-foreground'>{jsonString}</pre>
        </div>
      </div>

      {/* Modal for large data */}
      {isModalOpen && (
        <div className='fixed inset-0 z-[200] flex items-center justify-center bg-black/50'>
          <div className='mx-4 h-[80vh] w-full max-w-4xl rounded-lg border bg-background shadow-lg'>
            <div className='flex items-center justify-between border-b p-4'>
              <h3 className='font-medium text-foreground text-lg'>{title}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
              >
                <X className='h-4 w-4' />
              </button>
            </div>
            <div className='h-[calc(80vh-4rem)] overflow-auto p-4'>
              <pre className='whitespace-pre-wrap break-words font-mono text-foreground text-sm'>{jsonString}</pre>
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

function PinnedLogs({ executionData, onClose }: { executionData: any; onClose: () => void }) {
  const [currentIterationIndex, setCurrentIterationIndex] = useState(0)

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

  useEffect(() => {
    setCurrentIterationIndex(0)
  }, [executionData])

  return (
    <Card className='fixed top-4 right-4 z-[100] max-h-[calc(100vh-8rem)] w-96 overflow-y-auto border-border bg-background shadow-lg'>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center gap-2 text-foreground text-lg'>
            <Zap className='h-5 w-5' />
            {formatted.blockName}
          </CardTitle>
          <button onClick={onClose} className='rounded-sm p-1 text-foreground hover:bg-muted'>
            <X className='h-4 w-4' />
          </button>
        </div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Badge variant={formatted.status === 'success' ? 'default' : 'destructive'}>
              {formatted.blockType}
            </Badge>
            <Badge variant='outline'>{formatted.status}</Badge>
          </div>

          {/* Iteration Navigation */}
          {iterationInfo.hasMultipleIterations && (
            <div className='flex items-center gap-1'>
              <button
                onClick={goToPreviousIteration}
                disabled={currentIterationIndex === 0}
                className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
              >
                <ChevronLeft className='h-4 w-4' />
              </button>
              <span className='px-2 text-muted-foreground text-xs'>
                {currentIterationIndex + 1} / {iterationInfo.totalIterations}
              </span>
              <button
                onClick={goToNextIteration}
                disabled={currentIterationIndex === totalIterations - 1}
                className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
              >
                <ChevronRight className='h-4 w-4' />
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        <div className='grid grid-cols-2 gap-4'>
          <div className='flex items-center gap-2'>
            <Clock className='h-4 w-4 text-muted-foreground' />
            <span className='text-foreground text-sm'>{formatted.duration}</span>
          </div>

          {formatted.cost && formatted.cost.total > 0 && (
            <div className='flex items-center gap-2'>
              <DollarSign className='h-4 w-4 text-muted-foreground' />
              <span className='text-foreground text-sm'>${formatted.cost.total.toFixed(5)}</span>
            </div>
          )}

          {formatted.tokens && formatted.tokens.total > 0 && (
            <div className='flex items-center gap-2'>
              <Hash className='h-4 w-4 text-muted-foreground' />
              <span className='text-foreground text-sm'>{formatted.tokens.total} tokens</span>
            </div>
          )}
        </div>

        <ExpandableDataSection
          title="Input"
          data={formatted.input}
        />

        <ExpandableDataSection
          title="Output"
          data={formatted.output}
        />

        {formatted.cost && formatted.cost.total > 0 && (
          <div>
            <h4 className='mb-2 font-medium text-foreground text-sm'>Cost Breakdown</h4>
            <div className='space-y-1 text-sm'>
              <div className='flex justify-between text-foreground'>
                <span>Input:</span>
                <span>${formatted.cost.input.toFixed(5)}</span>
              </div>
              <div className='flex justify-between text-foreground'>
                <span>Output:</span>
                <span>${formatted.cost.output.toFixed(5)}</span>
              </div>
              <div className='flex justify-between border-border border-t pt-1 font-medium text-foreground'>
                <span>Total:</span>
                <span>${formatted.cost.total.toFixed(5)}</span>
              </div>
            </div>
          </div>
        )}

        {formatted.tokens && formatted.tokens.total > 0 && (
          <div>
            <h4 className='mb-2 font-medium text-foreground text-sm'>Token Usage</h4>
            <div className='space-y-1 text-sm'>
              <div className='flex justify-between text-foreground'>
                <span>Prompt:</span>
                <span>{formatted.tokens.prompt}</span>
              </div>
              <div className='flex justify-between text-foreground'>
                <span>Completion:</span>
                <span>{formatted.tokens.completion}</span>
              </div>
              <div className='flex justify-between border-border border-t pt-1 font-medium text-foreground'>
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

      const workflowSpan = traceSpans[0]
      if (workflowSpan?.children && Array.isArray(workflowSpan.children)) {
        const traceSpansByBlockId = workflowSpan.children.reduce((acc: any, span: any) => {
          if (span.blockId) {
            if (!acc[span.blockId]) {
              acc[span.blockId] = []
            }
            acc[span.blockId].push(span)
          }
          return acc
        }, {})

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
      }

      setBlockExecutions(blockExecutionMap)
    }
  }, [traceSpans])

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/logs/${executionId}/frozen-canvas`)
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

  // No need to create a temporary workflow - just use the workflowState directly

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='flex items-center gap-2 text-muted-foreground'>
          <Loader2 className='h-5 w-5 animate-spin' />
          <span>Loading frozen canvas...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='flex items-center gap-2 text-destructive'>
          <AlertCircle className='h-5 w-5' />
          <span>Failed to load frozen canvas: {error}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height, width }}>
        <div className='text-muted-foreground'>No data available</div>
      </div>
    )
  }

  // Check if this is a migrated log without real workflow state
  const isMigratedLog = (data.workflowState as any)?._migrated === true
  if (isMigratedLog) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-4 p-8', className)}
        style={{ height, width }}
      >
        <div className='flex items-center gap-3 text-amber-600 dark:text-amber-400'>
          <AlertCircle className='h-6 w-6' />
          <span className='font-medium text-lg'>Logged State Not Found</span>
        </div>
        <div className='max-w-md text-center text-muted-foreground text-sm'>
          This log was migrated from the old logging system. The workflow state at execution time is
          not available.
        </div>
        <div className='text-muted-foreground text-xs'>
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
          onNodeClick={(blockId) => {
            if (blockExecutions[blockId]) {
              setPinnedBlockId(blockId)
            }
          }}
        />
      </div>

      {pinnedBlockId && blockExecutions[pinnedBlockId] && (
        <PinnedLogs
          executionData={blockExecutions[pinnedBlockId]}
          onClose={() => setPinnedBlockId(null)}
        />
      )}
    </>
  )
}
