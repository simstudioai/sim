'use client'

import { memo } from 'react'
import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Duplicate,
  Eye,
  Link,
  ListFilter,
  Redo,
  SquareArrowUpRight,
  X,
} from '@/components/emcn'
import type { WorkflowLogSummary } from '@/lib/api/contracts/logs'

interface LogRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  log: WorkflowLogSummary | null
  onCopyExecutionId: () => void
  onCopyLink: () => void
  onOpenWorkflow: () => void
  onOpenPreview: () => void
  onToggleWorkflowFilter: () => void
  onClearAllFilters: () => void
  onCancelExecution: () => void
  onRetryExecution: () => void
  isRetryPending?: boolean
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
  onRetryExecution,
  isRetryPending = false,
  isFilteredByThisWorkflow,
  hasActiveFilters,
}: LogRowContextMenuProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const hasExecutionId = Boolean(log?.executionId)
  const hasWorkflow = Boolean(log?.workflow?.id || log?.workflowId)
  const isCancellable =
    (log?.status === 'running' || log?.status === 'pending') && hasExecutionId && hasWorkflow
  const isRetryable = log?.status === 'failed' && hasWorkflow && log?.trigger !== 'mothership'

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
        {isRetryable && (
          <>
            <DropdownMenuItem onSelect={onRetryExecution} disabled={isRetryPending}>
              <Redo />
              {isRetryPending ? 'Retrying...' : tI18n('retry')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {isCancellable && (
          <>
            <DropdownMenuItem onSelect={onCancelExecution}>
              <X />
              {t('cancel_run')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!hasExecutionId} onSelect={onCopyExecutionId}>
          <Duplicate />
          {t('copy_run_id')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasExecutionId} onSelect={onCopyLink}>
          <Link />
          {t('copy_link')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasWorkflow} onSelect={onOpenWorkflow}>
          <SquareArrowUpRight />
          {t('open_workflow')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasExecutionId} onSelect={onOpenPreview}>
          <Eye />
          {t('open_snapshot')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        {!isFilteredByThisWorkflow && (
          <DropdownMenuItem disabled={!hasWorkflow} onSelect={onToggleWorkflowFilter}>
            <ListFilter />
            {t('filter_by_workflow')}
          </DropdownMenuItem>
        )}
        {hasActiveFilters && (
          <DropdownMenuItem onSelect={onClearAllFilters}>
            <X />
            {t('clear_filters')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
