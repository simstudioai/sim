'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Modal, ModalBody, ModalContent, ModalHeader } from '@/components/emcn'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { cn } from '@/lib/core/utils/cn'
import {
  BlockDetailsSidebar,
  WorkflowPreview,
} from '@/app/workspace/[workspaceId]/w/components/preview'
import { useExecutionSnapshot } from '@/hooks/queries/logs'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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
  const { data, isLoading, error } = useExecutionSnapshot(executionId)
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null)

  // Process traceSpans to create blockExecutions map
  const blockExecutions = useMemo(() => {
    if (!traceSpans || !Array.isArray(traceSpans)) return {}

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

    return blockExecutionMap
  }, [traceSpans])

  // Reset pinned block when executionId changes
  useEffect(() => {
    setPinnedBlockId(null)
  }, [executionId])

  const workflowState = data?.workflowState as WorkflowState | undefined

  const renderContent = () => {
    if (isLoading) {
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
            <span className='text-[13px]'>Failed to load execution snapshot: {error.message}</span>
          </div>
        </div>
      )
    }

    if (!data || !workflowState) {
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

    if (isMigratedWorkflowState(workflowState)) {
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
          <div className='text-[12px] text-[var(--text-tertiary)]'>Note: {workflowState._note}</div>
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
            workflowState={workflowState}
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
        {pinnedBlockId && workflowState.blocks[pinnedBlockId] && (
          <BlockDetailsSidebar
            block={workflowState.blocks[pinnedBlockId]}
            executionData={blockExecutions[pinnedBlockId]}
            allBlockExecutions={blockExecutions}
            workflowBlocks={workflowState.blocks}
            isExecutionMode
          />
        )}
      </div>
    )
  }

  if (isModal) {
    return (
      <Modal
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPinnedBlockId(null)
            onClose()
          }
        }}
      >
        <ModalContent size='full' className='flex h-[90vh] flex-col'>
          <ModalHeader>Workflow State</ModalHeader>

          <ModalBody className='!p-0 min-h-0 flex-1'>{renderContent()}</ModalBody>
        </ModalContent>
      </Modal>
    )
  }

  return renderContent()
}
