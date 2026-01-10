'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { redactApiKeys } from '@/lib/core/security/redaction'
import { cn } from '@/lib/core/utils/cn'
import {
  BlockDetailsSidebar,
  getLeftmostBlockId,
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
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null)
  const autoSelectedForExecutionRef = useRef<string | null>(null)

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const [contextMenuBlockId, setContextMenuBlockId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
    setContextMenuBlockId(null)
  }, [])

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuBlockId(null)
    setMenuPosition({ x: e.clientX, y: e.clientY })
    setIsMenuOpen(true)
  }, [])

  const handleNodeContextMenu = useCallback(
    (blockId: string, mousePosition: { x: number; y: number }) => {
      setContextMenuBlockId(blockId)
      setMenuPosition(mousePosition)
      setIsMenuOpen(true)
    },
    []
  )

  const handleCopyExecutionId = useCallback(() => {
    navigator.clipboard.writeText(executionId)
    closeMenu()
  }, [executionId, closeMenu])

  const handleOpenDetails = useCallback(() => {
    if (contextMenuBlockId) {
      setPinnedBlockId(contextMenuBlockId)
    }
    closeMenu()
  }, [contextMenuBlockId, closeMenu])

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

  const workflowState = data?.workflowState as WorkflowState | undefined

  // Auto-select the leftmost block once when data loads for a new executionId
  useEffect(() => {
    if (
      workflowState &&
      !isMigratedWorkflowState(workflowState) &&
      autoSelectedForExecutionRef.current !== executionId
    ) {
      autoSelectedForExecutionRef.current = executionId
      const leftmostId = getLeftmostBlockId(workflowState)
      setPinnedBlockId(leftmostId)
    }
  }, [executionId, workflowState])

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
          'flex overflow-hidden',
          !isModal && 'rounded-[4px] border border-[var(--border)]',
          className
        )}
      >
        <div className='h-full flex-1' onContextMenu={handleCanvasContextMenu}>
          <WorkflowPreview
            workflowState={workflowState}
            isPannable={true}
            defaultPosition={{ x: 0, y: 0 }}
            defaultZoom={0.8}
            onNodeClick={(blockId) => {
              setPinnedBlockId(blockId)
            }}
            onNodeContextMenu={handleNodeContextMenu}
            onPaneClick={() => setPinnedBlockId(null)}
            cursorStyle='pointer'
            executedBlocks={blockExecutions}
            selectedBlockId={pinnedBlockId}
            lightweight
          />
        </div>
        {pinnedBlockId && workflowState.blocks[pinnedBlockId] && (
          <BlockDetailsSidebar
            block={workflowState.blocks[pinnedBlockId]}
            executionData={blockExecutions[pinnedBlockId]}
            allBlockExecutions={blockExecutions}
            workflowBlocks={workflowState.blocks}
            workflowVariables={workflowState.variables}
            loops={workflowState.loops}
            parallels={workflowState.parallels}
            isExecutionMode
            onClose={() => setPinnedBlockId(null)}
          />
        )}
      </div>
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
              {contextMenuBlockId && (
                <PopoverItem onClick={handleOpenDetails}>Open Details</PopoverItem>
              )}
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
              setPinnedBlockId(null)
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
