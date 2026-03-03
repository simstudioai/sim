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
import type { ContextMenuPosition } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'

export interface OutputContextMenuProps {
  isOpen: boolean
  position: ContextMenuPosition
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onCopySelection: () => void
  onCopyAll: () => void
  onSearch: () => void
  structuredView: boolean
  onToggleStructuredView: () => void
  wrapText: boolean
  onToggleWrap: () => void
  openOnRun: boolean
  onToggleOpenOnRun: () => void
  onClearConsole: () => void
  hasSelection: boolean
}

/**
 * Context menu for terminal output panel (right side).
 * Displays copy, search, and display options for the code viewer.
 */
export const OutputContextMenu = memo(function OutputContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onCopySelection,
  onCopyAll,
  onSearch,
  structuredView,
  onToggleStructuredView,
  wrapText,
  onToggleWrap,
  openOnRun,
  onToggleOpenOnRun,
  onClearConsole,
  hasSelection,
}: OutputContextMenuProps) {
  const t = useTranslations()

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
        {/* Copy and search actions */}
        <PopoverItem
          disabled={!hasSelection}
          onClick={() => {
            onCopySelection()
            onClose()
          }}
        >
          {t('terminal.buttons.copy_selection')}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onCopyAll()
            onClose()
          }}
        >
          {t('terminal.buttons.copy_all')}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onSearch()
            onClose()
          }}
        >
          {t('terminal.buttons.search')}
        </PopoverItem>

        {/* Display settings - toggles don't close menu */}
        <PopoverDivider />
        <PopoverItem showCheck={structuredView} onClick={onToggleStructuredView}>
          {t('terminal.buttons.structured_view')}
        </PopoverItem>
        <PopoverItem showCheck={wrapText} onClick={onToggleWrap}>
          {t('terminal.buttons.wrap_text')}
        </PopoverItem>
        <PopoverItem showCheck={openOnRun} onClick={onToggleOpenOnRun}>
          {t('terminal.buttons.open_on_run')}
        </PopoverItem>

        {/* Destructive action */}
        <PopoverDivider />
        <PopoverItem
          onClick={() => {
            onClearConsole()
            onClose()
          }}
        >
          {t('terminal.buttons.clear_console')}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
})
