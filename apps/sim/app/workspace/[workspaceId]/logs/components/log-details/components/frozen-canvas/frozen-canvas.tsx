'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
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
import { Modal, ModalBody, ModalContent, ModalHeader } from '@/components/emcn'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { cn } from '@/lib/core/utils/cn'
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
        <div className='mb-[6px] flex items-center justify-between'>
          <h4 className='font-medium text-[13px] text-[var(--text-primary)]'>{title}</h4>
          <div className='flex items-center gap-[4px]'>
            {isLargeData && (
              <button
                onClick={() => setIsModalOpen(true)}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
                title='Expand in modal'
                type='button'
              >
                <Maximize2 className='h-[14px] w-[14px]' />
              </button>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
              type='button'
            >
              {isExpanded ? (
                <ChevronUp className='h-[14px] w-[14px]' />
              ) : (
                <ChevronDown className='h-[14px] w-[14px]' />
              )}
            </button>
          </div>
        </div>
        <div
          className={cn(
            'overflow-y-auto rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[12px] font-mono text-[12px] transition-all duration-200',
            isExpanded ? 'max-h-96' : 'max-h-32'
          )}
        >
          <pre className='whitespace-pre-wrap break-words text-[var(--text-primary)]'>
            {jsonString}
          </pre>
        </div>
      </div>

      {isModalOpen && (
        <div className='fixed inset-0 z-[200] flex items-center justify-center bg-black/50'>
          <div className='mx-[16px] flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] shadow-lg'>
            <div className='flex items-center justify-between border-[var(--border)] border-b p-[16px]'>
              <h3 className='font-medium text-[15px] text-[var(--text-primary)]'>{title}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
                type='button'
              >
                <X className='h-[16px] w-[16px]' />
              </button>
            </div>
            <div className='flex-1 overflow-auto p-[16px]'>
              <pre className='whitespace-pre-wrap break-words font-mono text-[13px] text-[var(--text-primary)]'>
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
          input: tokens.input || tokens.prompt || 0,
          output: tokens.output || tokens.completion || 0,
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
  const [currentIterationIndex, setCurrentIterationIndex] = useState(0)

  useEffect(() => {
    setCurrentIterationIndex(0)
  }, [executionData])

  if (!executionData) {
    const blockInfo = workflowState?.blocks?.[blockId]
    const formatted = {
      blockName: blockInfo?.name || 'Unknown Block',
      blockType: blockInfo?.type || 'unknown',
      status: 'not_executed',
    }

    return (
      <Card className='fixed top-[16px] right-[16px] z-[100] max-h-[calc(100vh-8rem)] w-96 overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] shadow-lg'>
        <CardHeader className='pb-[12px]'>
          <div className='flex items-center justify-between'>
            <CardTitle className='flex items-center gap-[8px] text-[15px] text-[var(--text-primary)]'>
              <Zap className='h-[16px] w-[16px]' />
              {formatted.blockName}
            </CardTitle>
            <button
              onClick={onClose}
              className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
              type='button'
            >
              <X className='h-[16px] w-[16px]' />
            </button>
          </div>
          <div className='flex items-center gap-[8px]'>
            <Badge variant='secondary'>{formatted.blockType}</Badge>
            <Badge variant='outline'>not executed</Badge>
          </div>
        </CardHeader>

        <CardContent className='space-y-[16px]'>
          <div className='rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[16px] text-center'>
            <div className='text-[13px] text-[var(--text-secondary)]'>
              This block was not executed because the workflow failed before reaching it.
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

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
    <Card className='fixed top-[16px] right-[16px] z-[100] max-h-[calc(100vh-8rem)] w-96 overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] shadow-lg'>
      <CardHeader className='pb-[12px]'>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center gap-[8px] text-[15px] text-[var(--text-primary)]'>
            <Zap className='h-[16px] w-[16px]' />
            {formatted.blockName}
          </CardTitle>
          <button
            onClick={onClose}
            className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
            type='button'
          >
            <X className='h-[16px] w-[16px]' />
          </button>
        </div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Badge variant={formatted.status === 'success' ? 'default' : 'destructive'}>
              {formatted.blockType}
            </Badge>
            <Badge variant='outline'>{formatted.status}</Badge>
          </div>

          {iterationInfo.hasMultipleIterations && (
            <div className='flex items-center gap-[4px]'>
              <button
                onClick={goToPreviousIteration}
                disabled={currentIterationIndex === 0}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50'
                type='button'
              >
                <ChevronLeft className='h-[14px] w-[14px]' />
              </button>
              <span className='px-[8px] text-[12px] text-[var(--text-tertiary)]'>
                {iterationInfo.totalIterations !== undefined
                  ? `${currentIterationIndex + 1} / ${iterationInfo.totalIterations}`
                  : `${currentIterationIndex + 1}`}
              </span>
              <button
                onClick={goToNextIteration}
                disabled={currentIterationIndex === totalIterations - 1}
                className='rounded-[4px] p-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50'
                type='button'
              >
                <ChevronRight className='h-[14px] w-[14px]' />
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className='space-y-[16px]'>
        <div className='grid grid-cols-2 gap-[12px]'>
          <div className='flex items-center gap-[8px]'>
            <Clock className='h-[14px] w-[14px] text-[var(--text-secondary)]' />
            <span className='text-[13px] text-[var(--text-primary)]'>{formatted.duration}</span>
          </div>

          {formatted.cost && formatted.cost.total > 0 && (
            <div className='flex items-center gap-[8px]'>
              <DollarSign className='h-[14px] w-[14px] text-[var(--text-secondary)]' />
              <span className='text-[13px] text-[var(--text-primary)]'>
                ${formatted.cost.total.toFixed(5)}
              </span>
            </div>
          )}

          {formatted.tokens && formatted.tokens.total > 0 && (
            <div className='flex items-center gap-[8px]'>
              <Hash className='h-[14px] w-[14px] text-[var(--text-secondary)]' />
              <span className='text-[13px] text-[var(--text-primary)]'>
                {formatted.tokens.total} tokens
              </span>
            </div>
          )}
        </div>

        <ExpandableDataSection title='Input' data={formatted.input} />

        <ExpandableDataSection title='Output' data={formatted.output} />

        {formatted.cost && formatted.cost.total > 0 && (
          <div>
            <h4 className='mb-[6px] font-medium text-[13px] text-[var(--text-primary)]'>
              Cost Breakdown
            </h4>
            <div className='space-y-[4px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[12px] text-[13px]'>
              <div className='flex justify-between text-[var(--text-primary)]'>
                <span>Input:</span>
                <span>${formatted.cost.input.toFixed(5)}</span>
              </div>
              <div className='flex justify-between text-[var(--text-primary)]'>
                <span>Output:</span>
                <span>${formatted.cost.output.toFixed(5)}</span>
              </div>
              <div className='flex justify-between border-[var(--border)] border-t pt-[4px] font-medium text-[var(--text-primary)]'>
                <span>Total:</span>
                <span>${formatted.cost.total.toFixed(5)}</span>
              </div>
            </div>
          </div>
        )}

        {formatted.tokens && formatted.tokens.total > 0 && (
          <div>
            <h4 className='mb-[6px] font-medium text-[13px] text-[var(--text-primary)]'>
              Token Usage
            </h4>
            <div className='space-y-[4px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-3)] p-[12px] text-[13px]'>
              <div className='flex justify-between text-[var(--text-primary)]'>
                <span>Input:</span>
                <span>{formatted.tokens.input}</span>
              </div>
              <div className='flex justify-between text-[var(--text-primary)]'>
                <span>Output:</span>
                <span>{formatted.tokens.output}</span>
              </div>
              <div className='flex justify-between border-[var(--border)] border-t pt-[4px] font-medium text-[var(--text-primary)]'>
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
  isModal?: boolean
  isOpen?: boolean
  onClose?: () => void
}

export function FrozenCanvas({
  executionId,
  traceSpans,
  className,
  height = '100%',
  width = '100%',
  isModal = false,
  isOpen = false,
  onClose,
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
              input: null,
              output: null,
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

  const renderContent = () => {
    if (loading) {
      return (
        <div
          className={cn('flex items-center justify-center', className)}
          style={{ height, width }}
        >
          <div className='flex items-center gap-[8px] text-[var(--text-secondary)]'>
            <Loader2 className='h-[16px] w-[16px] animate-spin' />
            <span className='text-[13px]'>Loading frozen canvas...</span>
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div
          className={cn('flex items-center justify-center', className)}
          style={{ height, width }}
        >
          <div className='flex items-center gap-[8px] text-[var(--text-error)]'>
            <AlertCircle className='h-[16px] w-[16px]' />
            <span className='text-[13px]'>Failed to load frozen canvas: {error}</span>
          </div>
        </div>
      )
    }

    if (!data) {
      return (
        <div
          className={cn('flex items-center justify-center', className)}
          style={{ height, width }}
        >
          <div className='text-[13px] text-[var(--text-secondary)]'>No data available</div>
        </div>
      )
    }

    const isMigratedLog = (data.workflowState as any)?._migrated === true
    if (isMigratedLog) {
      return (
        <div
          className={cn('flex flex-col items-center justify-center gap-[16px] p-[32px]', className)}
          style={{ height, width }}
        >
          <div className='flex items-center gap-[12px] text-[var(--text-warning)]'>
            <AlertCircle className='h-[20px] w-[20px]' />
            <span className='font-medium text-[15px]'>Logged State Not Found</span>
          </div>
          <div className='max-w-md text-center text-[13px] text-[var(--text-secondary)]'>
            This log was migrated from the old logging system. The workflow state at execution time
            is not available.
          </div>
          <div className='text-[12px] text-[var(--text-tertiary)]'>
            Note: {(data.workflowState as any)?._note}
          </div>
        </div>
      )
    }

    return (
      <>
        <div
          style={{ height, width }}
          className={cn('frozen-canvas-mode h-full w-full', className)}
        >
          <WorkflowPreview
            workflowState={data.workflowState}
            showSubBlocks={true}
            isPannable={true}
            defaultPosition={{ x: 0, y: 0 }}
            defaultZoom={0.8}
            onNodeClick={(blockId) => {
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

  if (isModal) {
    return (
      <Modal open={isOpen} onOpenChange={onClose}>
        <ModalContent size='xl' className='flex h-[90vh] flex-col'>
          <ModalHeader>Workflow State</ModalHeader>

          <ModalBody className='min-h-0 flex-1'>
            <div className='flex h-full flex-col'>
              <div className='min-h-0 flex-1 overflow-hidden rounded-[4px] border border-[var(--border)]'>
                {renderContent()}
              </div>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    )
  }

  return renderContent()
}
