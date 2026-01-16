'use client'

import type { RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import type { WorkflowLog } from '@/stores/logs/filters/types'

interface LogRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  log: WorkflowLog | null
  onCopyExecutionId: () => void
  onOpenWorkflow: () => void
  onOpenPreview: () => void
  onToggleWorkflowFilter: () => void
  onClearAllFilters: () => void
  isFilteredByThisWorkflow: boolean
  hasActiveFilters: boolean
}

/**
 * Context menu for log rows.
 * Provides quick actions for copying data, navigation, and filtering.
 */
export function LogRowContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  log,
  onCopyExecutionId,
  onOpenWorkflow,
  onOpenPreview,
  onToggleWorkflowFilter,
  onClearAllFilters,
  isFilteredByThisWorkflow,
  hasActiveFilters,
}: LogRowContextMenuProps) {
  const hasExecutionId = Boolean(log?.executionId)
  const hasWorkflow = Boolean(log?.workflow?.id || log?.workflowId)

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        {/* Copy action */}
        <PopoverItem
          disabled={!hasExecutionId}
          onClick={() => {
            onCopyExecutionId()
            onClose()
          }}
        >
          Copy Execution ID
        </PopoverItem>

        {/* Navigation */}
        <PopoverDivider />
        <PopoverItem
          disabled={!hasWorkflow}
          onClick={() => {
            onOpenWorkflow()
            onClose()
          }}
        >
          Open Workflow
        </PopoverItem>
        <PopoverItem
          disabled={!hasExecutionId}
          onClick={() => {
            onOpenPreview()
            onClose()
          }}
        >
          Open Snapshot
        </PopoverItem>

        {/* Filter actions */}
        <PopoverDivider />
        {!isFilteredByThisWorkflow && (
          <PopoverItem
            disabled={!hasWorkflow}
            onClick={() => {
              onToggleWorkflowFilter()
              onClose()
            }}
          >
            Filter by Workflow
          </PopoverItem>
        )}
        {hasActiveFilters && (
          <PopoverItem
            onClick={() => {
              onClearAllFilters()
              onClose()
            }}
          >
            Clear Filters
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
