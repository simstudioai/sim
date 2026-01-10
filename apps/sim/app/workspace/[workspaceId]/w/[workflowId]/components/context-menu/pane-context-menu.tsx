'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
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
  onToggleVariables,
  onToggleChat,
  onInvite,
  isVariablesOpen = false,
  isChatOpen = false,
  hasClipboard = false,
  disableEdit = false,
  disableAdmin = false,
  canUndo = false,
  canRedo = false,
}: PaneContextMenuProps) {
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
          <span>Undo</span>
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
          <span>Redo</span>
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
          <span>Paste</span>
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
          <span>Add Block</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘K</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onAutoLayout()
            onClose()
          }}
        >
          <span>Auto-layout</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⇧L</span>
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
          <span>Open Logs</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘L</span>
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleVariables()
            onClose()
          }}
        >
          {isVariablesOpen ? 'Close Variables' : 'Open Variables'}
        </PopoverItem>
        <PopoverItem
          onClick={() => {
            onToggleChat()
            onClose()
          }}
        >
          {isChatOpen ? 'Close Chat' : 'Open Chat'}
        </PopoverItem>

        {/* Admin action */}
        <PopoverDivider />
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
