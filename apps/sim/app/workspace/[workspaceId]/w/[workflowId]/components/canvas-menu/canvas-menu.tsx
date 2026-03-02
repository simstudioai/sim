'use client'

import type { RefObject } from 'react'
import { useTranslations } from 'next-intl'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

/**
 * Props for CanvasMenu component
 */
export interface CanvasMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onUndo: () => void
  onRedo: () => void
  onPaste: () => void
  onAddBlock: () => void
  onAutoLayout: () => void
  onFitToView: () => void
  onOpenLogs: () => void
  onToggleVariables: () => void
  onToggleChat: () => void
  isVariablesOpen?: boolean
  isChatOpen?: boolean
  hasClipboard?: boolean
  disableEdit?: boolean
  disableAdmin?: boolean
  canUndo?: boolean
  canRedo?: boolean
  isInvitationsDisabled?: boolean
  /** Whether the workflow has locked blocks (disables auto-layout) */
  hasLockedBlocks?: boolean
}

/**
 * Context menu for workflow canvas.
 * Displays canvas-level actions when right-clicking empty space.
 */
export function CanvasMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onUndo,
  onRedo,
  onPaste,
  onAddBlock,
  onAutoLayout,
  onFitToView,
  onOpenLogs,
  onToggleVariables,
  onToggleChat,
  isVariablesOpen = false,
  isChatOpen = false,
  hasClipboard = false,
  disableEdit = false,
  canUndo = false,
  canRedo = false,
  hasLockedBlocks = false,
}: CanvasMenuProps) {
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
        {/* History actions */}
        <PopoverItem
          className='group'
          disabled={disableEdit || !canUndo}
          onClick={() => {
            onUndo()
            onClose()
          }}
        >
          <span>{t('workflows.canvas_menu.history.undo')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘Z</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || !canRedo}
          onClick={() => {
            onRedo()
            onClose()
          }}
        >
          <span>{t('workflows.canvas_menu.history.redo')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘⇧Z</span>
        </PopoverItem>

        {/* Edit and creation actions */}
        <PopoverDivider />
        <PopoverItem
          className='group'
          disabled={disableEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>{t('workflows.canvas_menu.edit.paste')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘V</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onAddBlock()
            onClose()
          }}
        >
          <span>{t('workflows.canvas_menu.edit.add_block')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘K</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || hasLockedBlocks}
          onClick={() => {
            onAutoLayout()
            onClose()
          }}
          title={hasLockedBlocks ? t('workflows.canvas_menu.edit.auto_layout_disabled') : undefined}
        >
          <span>{t('workflows.canvas_menu.edit.auto_layout')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⇧L</span>
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onFitToView()
            onClose()
          }}
        >
          {t('workflows.canvas_menu.edit.fit_to_view')}
        </PopoverItem>

        {/* Navigation actions */}
        <PopoverDivider />
        <PopoverItem
          className='group'
          onClick={() => {
            onOpenLogs()
            onClose()
          }}
        >
          <span>{t('workflows.canvas_menu.navigation.open_logs')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘L</span>
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleVariables()
            onClose()
          }}
        >
          {isVariablesOpen
            ? t('workflows.canvas_menu.navigation.close_variables')
            : t('workflows.canvas_menu.navigation.open_variables')}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleChat()
            onClose()
          }}
        >
          {isChatOpen
            ? t('workflows.canvas_menu.navigation.close_chat')
            : t('workflows.canvas_menu.navigation.open_chat')}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
