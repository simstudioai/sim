'use client'

import { memo, type RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import type {
  ContextMenuPosition,
  TerminalFilters,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'
import type { ConsoleEntry } from '@/stores/terminal'

export interface LogRowContextMenuProps {
  isOpen: boolean
  position: ContextMenuPosition
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  entry: ConsoleEntry | null
  filters: TerminalFilters
  onFilterByBlock: (blockId: string) => void
  onFilterByStatus: (status: 'error' | 'info') => void
  onCopyRunId: (runId: string) => void
  onClearConsole: () => void
  onFixInCopilot: (entry: ConsoleEntry) => void
}

/**
 * Context menu for terminal log rows (left side).
 * Displays filtering options based on the selected row's properties.
 */
export const LogRowContextMenu = memo(function LogRowContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  entry,
  filters,
  onFilterByBlock,
  onFilterByStatus,
  onCopyRunId,
  onClearConsole,
  onFixInCopilot,
}: LogRowContextMenuProps) {
  const hasRunId = entry?.executionId != null

  const isBlockFiltered = entry ? filters.blockIds.has(entry.blockId) : false
  const entryStatus = entry?.success ? 'info' : 'error'
  const isStatusFiltered = entry ? filters.statuses.has(entryStatus) : false

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
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
        {/* Copy actions */}
        {entry && hasRunId && (
          <>
            <PopoverItem
              onClick={() => {
                onCopyRunId(entry.executionId!)
                onClose()
              }}
            >
              Copy Run ID
            </PopoverItem>
            <PopoverDivider />
          </>
        )}

        {/* Fix in Copilot - only for error rows */}
        {entry && !entry.success && (
          <>
            <PopoverItem
              onClick={() => {
                onFixInCopilot(entry)
                onClose()
              }}
            >
              Fix in Copilot
            </PopoverItem>
            <PopoverDivider />
          </>
        )}

        {/* Filter actions */}
        {entry && (
          <>
            <PopoverItem
              showCheck={isBlockFiltered}
              onClick={() => {
                onFilterByBlock(entry.blockId)
                onClose()
              }}
            >
              Filter by Block
            </PopoverItem>
            <PopoverItem
              showCheck={isStatusFiltered}
              onClick={() => {
                onFilterByStatus(entryStatus)
                onClose()
              }}
            >
              Filter by Status
            </PopoverItem>
          </>
        )}

        {/* Destructive action */}
        {entry && <PopoverDivider />}
        <PopoverItem
          onClick={() => {
            onClearConsole()
            onClose()
          }}
        >
          Clear Console
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
})
