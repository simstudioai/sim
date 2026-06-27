'use client'

import { memo, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('auto')
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
              {t('copy_run_id')}
            </PopoverItem>
            <PopoverDivider />
          </>
        )}

        {/* Fix in Chat - only for error rows */}
        {entry && !entry.success && (
          <>
            <PopoverItem
              onClick={() => {
                onFixInCopilot(entry)
                onClose()
              }}
            >
              {t('fix_in_chat')}
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
              {t('filter_by_block')}
            </PopoverItem>
            <PopoverItem
              showCheck={isStatusFiltered}
              onClick={() => {
                onFilterByStatus(entryStatus)
                onClose()
              }}
            >
              {t('filter_by_status')}
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
          {t('clear_console')}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
})
