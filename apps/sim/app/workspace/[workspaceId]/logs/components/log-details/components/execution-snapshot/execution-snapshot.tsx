'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Modal, ModalBody, ModalContent, ModalHeader } from '@/components/emcn'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { cn } from '@/lib/core/utils/cn'
import {
  BlockDetailsSidebar,
  WorkflowPreview,
} from '@/app/workspace/[workspaceId]/w/components/preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('ExecutionSnapshot')

interface TraceSpan {
  blockId?: string
  input?: unknown
  output?: unknown
  status?: string
  duration?: number
  children?: TraceSpan[]
}

interface BlockExecutionData {
  input: unknown
  output: unknown
  status: string
  durationMs: number
}

/**
 * Migrated logs have special properties to indicate they came from the old logging system
 */
interface MigratedWorkflowState extends WorkflowState {
  _migrated: true
  _note?: string
}

/**
 * Type guard to check if a workflow state is from a migrated log
 */
function isMigratedWorkflowState(state: WorkflowState): state is MigratedWorkflowState {
  return (state as MigratedWorkflowState)._migrated === true
}

interface ExecutionSnapshotData {
  executionId: string
  workflowId: string
  workflowState: WorkflowState | MigratedWorkflowState
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

interface ExecutionSnapshotProps {
  executionId: string
  traceSpans?: TraceSpan[]
  className?: string
  height?: string | number
  width?: string | number
  isModal?: boolean
  isOpen?: boolean
  onClose?: () => void
}

export function ExecutionSnapshot({
  executionId,
  traceSpans,
  className,
  height = '100%',
  width = '100%',
  isModal = false,
  isOpen = false,
  onClose = () => {},
}: ExecutionSnapshotProps) {
  const [data, setData] = useState<ExecutionSnapshotData | null>(null)
  const [blockExecutions, setBlockExecutions] = useState<Record<string, BlockExecutionData>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null)

  useEffect(() => {
    if (traceSpans && Array.isArray(traceSpans)) {
      const blockExecutionMap: Record<string, BlockExecutionData> = {}

      const collectBlockSpans = (spans: TraceSpan[]): TraceSpan[] => {
        const blockSpans: TraceSpan[] = []

        for (const span of spans) {
          if (span.blockId) {
            blockSpans.push(span)
          }
          if (span.children && Array.isArray(span.children)) {
            blockSpans.push(...collectBlockSpans(span.children))
          }
        }

        return blockSpans
      }

      const allBlockSpans = collectBlockSpans(traceSpans)

      for (const span of allBlockSpans) {
        if (span.blockId && !blockExecutionMap[span.blockId]) {
          blockExecutionMap[span.blockId] = {
            input: redactApiKeys(span.input || {}),
            output: redactApiKeys(span.output || {}),
            status: span.status || 'unknown',
            durationMs: span.duration || 0,
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

        const response = await fetch(`/api/logs/execution/${executionId}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch execution snapshot data: ${response.statusText}`)
        }

        const result = await response.json()
        setData(result)
        logger.debug(`Loaded execution snapshot data for execution: ${executionId}`)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        logger.error('Failed to fetch execution snapshot data:', err)
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
            <span className='text-[13px]'>Loading execution snapshot...</span>
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
            <span className='text-[13px]'>Failed to load execution snapshot: {error}</span>
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

    if (isMigratedWorkflowState(data.workflowState)) {
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
            Note: {data.workflowState._note}
          </div>
        </div>
      )
    }

    return (
      <div
        style={{ height, width }}
        className={cn(
          'flex overflow-hidden rounded-[4px] border border-[var(--border)]',
          className
        )}
      >
        <div className='h-full flex-1'>
          <WorkflowPreview
            workflowState={data.workflowState}
            showSubBlocks={true}
            isPannable={true}
            defaultPosition={{ x: 0, y: 0 }}
            defaultZoom={0.8}
            onNodeClick={(blockId) => {
              // Toggle: clicking same block closes sidebar, clicking different block switches
              setPinnedBlockId((prev) => (prev === blockId ? null : blockId))
            }}
            cursorStyle='pointer'
            executedBlocks={blockExecutions}
          />
        </div>
        {pinnedBlockId && data.workflowState.blocks[pinnedBlockId] && (
          <BlockDetailsSidebar
            block={data.workflowState.blocks[pinnedBlockId]}
            executionData={blockExecutions[pinnedBlockId]}
            allBlockExecutions={blockExecutions}
            workflowBlocks={data.workflowState.blocks}
            isExecutionMode
          />
        )}
      </div>
    )
  }

  if (isModal) {
    return (
      <Modal open={isOpen} onOpenChange={onClose}>
        <ModalContent size='full' className='flex h-[90vh] flex-col'>
          <ModalHeader>Workflow State</ModalHeader>

          <ModalBody className='!p-0 min-h-0 flex-1'>{renderContent()}</ModalBody>
        </ModalContent>
      </Modal>
    )
  }

  return renderContent()
}
