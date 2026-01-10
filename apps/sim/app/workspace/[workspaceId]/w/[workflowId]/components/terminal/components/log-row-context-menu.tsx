'use client'

import type { RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import type { ConsoleEntry } from '@/stores/terminal'

interface ContextMenuPosition {
  x: number
  y: number
}

interface TerminalFilters {
  blockIds: Set<string>
  statuses: Set<'error' | 'info'>
  runIds: Set<string>
}

interface LogRowContextMenuProps {
  isOpen: boolean
  position: ContextMenuPosition
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  entry: ConsoleEntry | null
  filters: TerminalFilters
  onFilterByBlock: (blockId: string) => void
  onFilterByStatus: (status: 'error' | 'info') => void
  onFilterByRunId: (runId: string) => void
  onCopyRunId: (runId: string) => void
  onClearFilters: () => void
  onClearConsole: () => void
  hasActiveFilters: boolean
}

/**
 * Context menu for terminal log rows (left side).
 * Displays filtering options based on the selected row's properties.
 */
export function LogRowContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  entry,
  filters,
  onFilterByBlock,
  onFilterByStatus,
  onFilterByRunId,
  onCopyRunId,
  onClearFilters,
  onClearConsole,
  hasActiveFilters,
}: LogRowContextMenuProps) {
  const hasRunId = entry?.executionId != null

  const isBlockFiltered = entry ? filters.blockIds.has(entry.blockId) : false
  const entryStatus = entry?.success ? 'info' : 'error'
  const isStatusFiltered = entry ? filters.statuses.has(entryStatus) : false
  const isRunIdFiltered = entry?.executionId ? filters.runIds.has(entry.executionId) : false

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
            {hasRunId && (
              <PopoverItem
                showCheck={isRunIdFiltered}
                onClick={() => {
                  onFilterByRunId(entry.executionId!)
                  onClose()
                }}
              >
                Filter by Run ID
              </PopoverItem>
            )}
          </>
        )}

        {/* Clear filters */}
        {hasActiveFilters && (
          <PopoverItem
            onClick={() => {
              onClearFilters()
              onClose()
            }}
          >
            Clear All Filters
          </PopoverItem>
        )}

        {/* Destructive action */}
        {(entry || hasActiveFilters) && <PopoverDivider />}
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
}
