'use client'

import { useCallback, useRef, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { Preview } from '@/app/workspace/[workspaceId]/w/components/preview'
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

interface MigratedWorkflowState extends WorkflowState {
  _migrated: true
  _note?: string
}

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

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
  }, [])

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPosition({ x: e.clientX, y: e.clientY })
    setIsMenuOpen(true)
  }, [])

  const handleCopyExecutionId = useCallback(() => {
    navigator.clipboard.writeText(executionId)
    closeMenu()
  }, [executionId, closeMenu])

  const workflowState = data?.workflowState as WorkflowState | undefined
  const childWorkflowSnapshots = data?.childWorkflowSnapshots as
    | Record<string, WorkflowState>
    | undefined

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
      <Preview
        key={executionId}
        workflowState={workflowState}
        traceSpans={traceSpans}
        childWorkflowSnapshots={childWorkflowSnapshots}
        className={className}
        height={height}
        width={width}
        onCanvasContextMenu={handleCanvasContextMenu}
        showBorder={!isModal}
        autoSelectLeftmost
      />
    )
  }

  const canvasContextMenu =
    typeof document !== 'undefined'
      ? createPortal(
          <Popover
            open={isMenuOpen}
            onOpenChange={closeMenu}
            variant='secondary'
            size='sm'
            colorScheme='inverted'
          >
            <PopoverAnchor
              style={{
                position: 'fixed',
                left: `${menuPosition.x}px`,
                top: `${menuPosition.y}px`,
                width: '1px',
                height: '1px',
              }}
            />
            <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
              <PopoverItem onClick={handleCopyExecutionId}>Copy Execution ID</PopoverItem>
            </PopoverContent>
          </Popover>,
          document.body
        )
      : null

  if (isModal) {
    return (
      <>
        <Modal
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) {
              onClose()
            }
          }}
        >
          <ModalContent size='full' className='flex h-[90vh] flex-col'>
            <ModalHeader>Workflow State</ModalHeader>

            <ModalBody className='!p-0 min-h-0 flex-1 overflow-hidden'>{renderContent()}</ModalBody>
          </ModalContent>
        </Modal>
        {canvasContextMenu}
      </>
    )
  }

  return (
    <>
      {renderContent()}
      {canvasContextMenu}
    </>
  )
}
