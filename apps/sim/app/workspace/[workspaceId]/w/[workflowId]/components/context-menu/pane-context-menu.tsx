'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import type { PaneContextMenuProps } from './types'

/**
 * Context menu for workflow canvas pane.
 * Displays canvas-level actions when right-clicking empty space.
 */
export function PaneContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onUndo,
  onRedo,
  onPaste,
  onAddBlock,
  onAutoLayout,
  onOpenLogs,
  onOpenVariables,
  onOpenChat,
  onInvite,
  hasClipboard = false,
  disableEdit = false,
  disableAdmin = false,
  canUndo = false,
  canRedo = false,
}: PaneContextMenuProps) {
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
        {/* Undo */}
        <PopoverItem
          className='group'
          disabled={disableEdit || !canUndo}
          onClick={() => {
            onUndo()
            onClose()
          }}
        >
          <span>Undo</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘Z</span>
        </PopoverItem>

        {/* Redo */}
        <PopoverItem
          className='group'
          disabled={disableEdit || !canRedo}
          onClick={() => {
            onRedo()
            onClose()
          }}
        >
          <span>Redo</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘⇧Z</span>
        </PopoverItem>

        {/* Paste */}
        <PopoverItem
          className='group'
          disabled={disableEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>Paste</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘V</span>
        </PopoverItem>

        {/* Add Block */}
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onAddBlock()
            onClose()
          }}
        >
          <span>Add Block</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘K</span>
        </PopoverItem>

        {/* Auto-layout */}
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onAutoLayout()
            onClose()
          }}
        >
          <span>Auto-layout</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⇧L</span>
        </PopoverItem>

        {/* Open Logs */}
        <PopoverItem
          className='group'
          onClick={() => {
            onOpenLogs()
            onClose()
          }}
        >
          <span>Open Logs</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘L</span>
        </PopoverItem>

        {/* Open Variables */}
        <PopoverItem
          onClick={() => {
            onOpenVariables()
            onClose()
          }}
        >
          Variables
        </PopoverItem>

        {/* Open Chat */}
        <PopoverItem
          onClick={() => {
            onOpenChat()
            onClose()
          }}
        >
          Open Chat
        </PopoverItem>

        {/* Invite to Workspace - admin only */}
        <PopoverItem
          disabled={disableAdmin}
          onClick={() => {
            onInvite()
            onClose()
          }}
        >
          Invite to Workspace
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
