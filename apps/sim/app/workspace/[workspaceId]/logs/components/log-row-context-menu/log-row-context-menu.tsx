'use client'

import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Copy, Eye, Link, ListFilter, SquareArrowUpRight, X } from '@/components/emcn/icons'
import type { WorkflowLog } from '@/stores/logs/filters/types'

interface LogRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  log: WorkflowLog | null
  onCopyExecutionId: () => void
  onCopyLink: () => void
  onOpenWorkflow: () => void
  onOpenPreview: () => void
  onToggleWorkflowFilter: () => void
  onClearAllFilters: () => void
  onCancelExecution: () => void
  isFilteredByThisWorkflow: boolean
  hasActiveFilters: boolean
}

/**
 * Context menu for log rows.
 * Provides quick actions for copying data, navigation, and filtering.
 */
export const LogRowContextMenu = memo(function LogRowContextMenu({
  isOpen,
  position,
  onClose,
  log,
  onCopyExecutionId,
  onCopyLink,
  onOpenWorkflow,
  onOpenPreview,
  onToggleWorkflowFilter,
  onClearAllFilters,
  onCancelExecution,
  isFilteredByThisWorkflow,
  hasActiveFilters,
}: LogRowContextMenuProps) {
  const hasExecutionId = Boolean(log?.executionId)
  const hasWorkflow = Boolean(log?.workflow?.id || log?.workflowId)
  const isCancellable =
    (log?.status === 'running' || log?.status === 'pending') && hasExecutionId && hasWorkflow

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
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
        {isCancellable && (
          <>
            <DropdownMenuItem onSelect={onCancelExecution}>
              <X />
              Cancel Execution
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!hasExecutionId} onSelect={onCopyExecutionId}>
          <Copy />
          Copy Execution ID
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasExecutionId} onSelect={onCopyLink}>
          <Link />
          Copy Link
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasWorkflow} onSelect={onOpenWorkflow}>
          <SquareArrowUpRight />
          Open Workflow
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasExecutionId} onSelect={onOpenPreview}>
          <Eye />
          Open Snapshot
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        {!isFilteredByThisWorkflow && (
          <DropdownMenuItem disabled={!hasWorkflow} onSelect={onToggleWorkflowFilter}>
            <ListFilter />
            Filter by Workflow
          </DropdownMenuItem>
        )}
        {hasActiveFilters && (
          <DropdownMenuItem onSelect={onClearAllFilters}>
            <X />
            Clear Filters
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
