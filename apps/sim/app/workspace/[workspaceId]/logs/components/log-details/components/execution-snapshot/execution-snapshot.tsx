'use client'

import type React from 'react'
import { useId, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalHeader,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Duplicate,
  Loader,
} from '@sim/emcn'
import { CircleAlert } from '@sim/emcn/icons'
import { createPortal } from 'react-dom'
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
  showBorder?: boolean
  isOpen?: boolean
  onClose?: () => void
  initialSelectedBlockId?: string | null
  autoSelectLeftmost?: boolean
  showBlockCloseButton?: boolean
}

export function ExecutionSnapshot({
  executionId,
  traceSpans,
  className,
  height = '100%',
  width = '100%',
  isModal = false,
  showBorder = !isModal,
  isOpen = false,
  onClose = () => {},
  initialSelectedBlockId,
  autoSelectLeftmost = true,
  showBlockCloseButton = !isModal,
}: ExecutionSnapshotProps) {
  const { data, isLoading, error } = useExecutionSnapshot(executionId)
  const modalDescriptionId = useId()

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })

  function closeMenu() {
    setIsMenuOpen(false)
  }

  function handleCanvasContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setMenuPosition({ x: e.clientX, y: e.clientY })
    setIsMenuOpen(true)
  }

  function handleCopyExecutionId() {
    navigator.clipboard.writeText(executionId)
    closeMenu()
  }

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
          <div className='flex items-center gap-2 text-[var(--text-secondary)]'>
            <Loader className='size-[16px]' animate />
            <span className='text-small'>Loading run snapshot…</span>
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
          <div className='flex items-center gap-2 text-[var(--text-error)]'>
            <CircleAlert className='size-[16px]' />
            <span className='text-small'>Failed to load run snapshot: {error.message}</span>
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
          <div className='flex items-center gap-2 text-[var(--text-secondary)]'>
            <Loader className='size-[16px]' animate />
            <span className='text-small'>Loading run snapshot…</span>
          </div>
        </div>
      )
    }

    if (isMigratedWorkflowState(workflowState)) {
      return (
        <div
          className={cn('flex flex-col items-center justify-center gap-4 p-8', className)}
          style={{ height, width }}
        >
          <div className='flex items-center gap-3 text-[var(--text-warning)]'>
            <CircleAlert className='size-[20px]' />
            <span className='text-base'>Logged State Not Found</span>
          </div>
          <div className='max-w-md text-center text-[var(--text-secondary)] text-small'>
            This log was migrated from the old logging system. The workflow state at the time of
            this run is not available.
          </div>
          <div className='text-[var(--text-tertiary)] text-caption'>
            Note: {workflowState._note}
          </div>
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
        showBorder={showBorder}
        initialSelectedBlockId={initialSelectedBlockId}
        autoSelectLeftmost={autoSelectLeftmost}
        showBlockCloseButton={showBlockCloseButton}
      />
    )
  }

  const canvasContextMenu =
    typeof document !== 'undefined'
      ? createPortal(
          <DropdownMenu open={isMenuOpen} onOpenChange={closeMenu} modal={false}>
            <DropdownMenuTrigger asChild>
              <div
                style={{
                  position: 'fixed',
                  left: `${menuPosition.x}px`,
                  top: `${menuPosition.y}px`,
                  width: '1px',
                  height: '1px',
                  pointerEvents: 'none',
                }}
                tabIndex={-1}
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='bottom'
              sideOffset={4}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onSelect={handleCopyExecutionId}>
                <Duplicate />
                Copy Run ID
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>,
          document.body
        )
      : null

  if (isModal) {
    return (
      <>
        <ChipModal
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) {
              onClose()
            }
          }}
          srTitle='Workflow State'
          aria-describedby={modalDescriptionId}
          size='full'
          className='h-[90vh] [&>div]:h-full'
        >
          <ChipModalHeader onClose={onClose}>Workflow State</ChipModalHeader>
          <ChipModalBody fullBleed>
            <p id={modalDescriptionId} className='sr-only'>
              View the workflow state snapshot for this execution
            </p>
            {renderContent()}
          </ChipModalBody>
        </ChipModal>
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
