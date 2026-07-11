'use client'

import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Eye, Lock, Pencil, Trash, Unlock } from '@sim/emcn/icons'

interface KnowledgeFolderContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen?: () => void
  onRename?: () => void
  onDelete?: () => void
  onToggleLock?: () => void
  canEdit: boolean
  showLock?: boolean
  disableLock?: boolean
  isLocked?: boolean
}

/**
 * Context menu for knowledge base folder rows: open, rename, lock, delete.
 */
export const KnowledgeFolderContextMenu = memo(function KnowledgeFolderContextMenu({
  isOpen,
  position,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onToggleLock,
  canEdit,
  showLock = false,
  disableLock = false,
  isLocked = false,
}: KnowledgeFolderContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          className='pointer-events-none fixed size-px'
          style={{ left: position.x, top: position.y }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {onOpen && (
          <DropdownMenuItem onSelect={onOpen}>
            <Eye />
            Open
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            {onRename && (
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            )}
            {showLock && onToggleLock && (
              <DropdownMenuItem disabled={disableLock} onSelect={onToggleLock}>
                {isLocked ? <Unlock /> : <Lock />}
                {isLocked ? 'Unlock' : 'Lock'}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem onSelect={onDelete}>
                <Trash />
                Delete
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
