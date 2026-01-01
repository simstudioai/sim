'use client'

import type { RefObject } from 'react'
import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import type { WorkflowLog } from '@/stores/logs/filters/types'

interface LogRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  log: WorkflowLog | null
  onCopyExecutionId: () => void
  onOpenWorkflow: () => void
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
  onToggleWorkflowFilter,
  onClearAllFilters,
  isFilteredByThisWorkflow,
  hasActiveFilters,
}: LogRowContextMenuProps) {
  const hasExecutionId = Boolean(log?.executionId)
  const hasWorkflow = Boolean(log?.workflow?.id || log?.workflowId)

  return (
    <Popover open={isOpen} onOpenChange={onClose} variant='secondary' size='sm'>
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
        {/* Copy Execution ID */}
        <PopoverItem
          disabled={!hasExecutionId}
          onClick={() => {
            onCopyExecutionId()
            onClose()
          }}
        >
          Copy Execution ID
        </PopoverItem>

        {/* Open Workflow */}
        <PopoverItem
          disabled={!hasWorkflow}
          onClick={() => {
            onOpenWorkflow()
            onClose()
          }}
        >
          Open Workflow
        </PopoverItem>

        {/* Filter by Workflow - only show when not already filtered by this workflow */}
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

        {/* Clear All Filters - show when any filters are active */}
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
