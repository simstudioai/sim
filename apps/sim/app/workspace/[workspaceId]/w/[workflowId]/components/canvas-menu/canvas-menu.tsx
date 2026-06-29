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
  onOpenSearchReplace: () => void
  onToggleVariables: () => void
  onToggleChat: () => void
  onToggleWorkflowLock?: () => void
  isVariablesOpen?: boolean
  isChatOpen?: boolean
  hasClipboard?: boolean
  disableEdit?: boolean
  canAdmin?: boolean
  canUndo?: boolean
  canRedo?: boolean
  isInvitationsDisabled?: boolean
  /** Whether the workflow has locked blocks (disables auto-layout) */
  hasLockedBlocks?: boolean
  /** Whether all blocks in the workflow are locked */
  allBlocksLocked?: boolean
  /** Whether the workflow has any blocks */
  hasBlocks?: boolean
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
  onOpenSearchReplace,
  onToggleVariables,
  onToggleChat,
  onToggleWorkflowLock,
  isVariablesOpen = false,
  isChatOpen = false,
  hasClipboard = false,
  disableEdit = false,
  canAdmin = false,
  canUndo = false,
  canRedo = false,
  hasLockedBlocks = false,
  allBlocksLocked = false,
  hasBlocks = false,
}: CanvasMenuProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
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
          <span>{t('undo')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('z')}</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || !canRedo}
          onClick={() => {
            onRedo()
            onClose()
          }}
        >
          <span>{t('redo')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('z_2')}</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>{t('paste')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('v')}</span>
        </PopoverItem>

        {/* Edit and creation actions */}
        <PopoverDivider />
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onAddBlock()
            onClose()
          }}
        >
          <span>{t('add_block')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('k')}</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || hasLockedBlocks}
          onClick={() => {
            onAutoLayout()
            onClose()
          }}
          title={hasLockedBlocks ? tI18n('unlock_blocks_to_use_auto_layout') : undefined}
        >
          <span>{t('auto_layout')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('l')}</span>
        </PopoverItem>
        {canAdmin && onToggleWorkflowLock && (
          <PopoverItem
            disabled={!hasBlocks}
            onClick={() => {
              onToggleWorkflowLock()
              onClose()
            }}
          >
            <span>{allBlocksLocked ? tI18n('unlock_workflow') : tI18n('lock_workflow')}</span>
          </PopoverItem>
        )}
        <PopoverItem
          onClick={() => {
            onFitToView()
            onClose()
          }}
        >
          {t('fit_to_view')}
        </PopoverItem>

        {/* Navigation actions */}
        <PopoverDivider />
        <PopoverItem
          className='group'
          onClick={() => {
            onOpenSearchReplace()
            onClose()
          }}
        >
          <span>{t('search_and_replace')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('f')}</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          onClick={() => {
            onOpenLogs()
            onClose()
          }}
        >
          <span>{t('open_logs')}</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>{t('l_2')}</span>
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleVariables()
            onClose()
          }}
        >
          {isVariablesOpen ? tI18n('close_variables') : tI18n('open_variables')}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleChat()
            onClose()
          }}
        >
          {isChatOpen ? tI18n('close_chat') : tI18n('open_chat')}
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
