'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import {
  Download,
  Duplicate,
  Eye,
  FolderPlus,
  ImageUp,
  Lock,
  LogOut,
  Mail,
  Pencil,
  Plus,
  SquareArrowUpRight,
  Trash,
  Unlock,
} from '@sim/emcn/icons'
import { Pin, PinOff } from 'lucide-react'

interface ContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onOpenInNewTab?: () => void
  onMarkAsRead?: () => void
  onMarkAsUnread?: () => void
  onTogglePin?: () => void
  onRename?: () => void
  /**
   * Ref to the rename input rendered by the "Rename" action, if any. Radix's
   * FocusScope defers its close-time focus teardown to a `setTimeout(0)`, which
   * can run after the rename input's own mount-time `focus()`/`select()` and
   * clobber the selection (the "rename deselects the text" bug). Focusing from
   * `onCloseAutoFocus` runs synchronously inside that same deferred teardown, so
   * it always wins the race regardless of scheduler timing.
   */
  renameInputRef?: React.RefObject<HTMLInputElement | null>
  onCreate?: () => void
  onCreateFolder?: () => void
  onDuplicate?: () => void
  onExport?: () => void
  onDelete: () => void
  showOpenInNewTab?: boolean
  showMarkAsRead?: boolean
  showMarkAsUnread?: boolean
  showPin?: boolean
  isPinned?: boolean
  showRename?: boolean
  showCreate?: boolean
  showCreateFolder?: boolean
  showDuplicate?: boolean
  showExport?: boolean
  disableExport?: boolean
  disableMarkAsRead?: boolean
  disableMarkAsUnread?: boolean
  disableRename?: boolean
  disableDuplicate?: boolean
  disableDelete?: boolean
  disableCreate?: boolean
  disableCreateFolder?: boolean
  onLeave?: () => void
  showLeave?: boolean
  disableLeave?: boolean
  onToggleLock?: () => void
  showLock?: boolean
  disableLock?: boolean
  isLocked?: boolean
  showDelete?: boolean
  onUploadLogo?: () => void
  showUploadLogo?: boolean
  disableUploadLogo?: boolean
}

/**
 * Context menu component for workflow, folder, and workspace items.
 * Uses DropdownMenu for accessible, hover-expandable submenus.
 */
export function ContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onMarkAsRead,
  onMarkAsUnread,
  onTogglePin,
  onRename,
  renameInputRef,
  onCreate,
  onCreateFolder,
  onDuplicate,
  onExport,
  onDelete,
  showOpenInNewTab = false,
  showMarkAsRead = false,
  showMarkAsUnread = false,
  showPin = false,
  isPinned = false,
  showRename = true,
  showCreate = false,
  showCreateFolder = false,
  showDuplicate = true,
  showExport = false,
  disableExport = false,
  disableMarkAsRead = false,
  disableMarkAsUnread = false,
  disableRename = false,
  disableDuplicate = false,
  disableDelete = false,
  disableCreate = false,
  disableCreateFolder = false,
  onLeave,
  showLeave = false,
  disableLeave = false,
  onToggleLock,
  showLock = false,
  disableLock = false,
  isLocked = false,
  showDelete = true,
  onUploadLogo,
  showUploadLogo = false,
  disableUploadLogo = false,
}: ContextMenuProps) {
  const hasNavigationSection = showOpenInNewTab && onOpenInNewTab
  const hasStatusSection =
    (showMarkAsRead && onMarkAsRead) ||
    (showMarkAsUnread && onMarkAsUnread) ||
    (showPin && onTogglePin)
  const hasEditSection =
    (showRename && onRename) ||
    (showCreate && onCreate) ||
    (showCreateFolder && onCreateFolder) ||
    (showLock && onToggleLock) ||
    (showUploadLogo && onUploadLogo)
  const hasCopySection = (showDuplicate && onDuplicate) || (showExport && onExport)

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menuRef}
        align='start'
        side='bottom'
        sideOffset={4}
        className='max-h-[var(--radix-dropdown-menu-content-available-height,400px)]'
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          const input = renameInputRef?.current
          if (input) {
            input.focus()
            input.select()
          }
        }}
      >
        {showOpenInNewTab && onOpenInNewTab && (
          <DropdownMenuItem
            onSelect={() => {
              onOpenInNewTab()
              onClose()
            }}
          >
            <SquareArrowUpRight />
            Open in new tab
          </DropdownMenuItem>
        )}
        {hasNavigationSection && (hasStatusSection || hasEditSection || hasCopySection) && (
          <DropdownMenuSeparator />
        )}

        {showMarkAsRead && onMarkAsRead && (
          <DropdownMenuItem
            disabled={disableMarkAsRead}
            onSelect={() => {
              onMarkAsRead()
              onClose()
            }}
          >
            <Eye />
            Mark as read
          </DropdownMenuItem>
        )}
        {showMarkAsUnread && onMarkAsUnread && (
          <DropdownMenuItem
            disabled={disableMarkAsUnread}
            onSelect={() => {
              onMarkAsUnread()
              onClose()
            }}
          >
            <Mail />
            Mark as unread
          </DropdownMenuItem>
        )}
        {showPin && onTogglePin && (
          <DropdownMenuItem
            onSelect={() => {
              onTogglePin()
              onClose()
            }}
          >
            {isPinned ? <PinOff className='size-[14px]' /> : <Pin className='size-[14px]' />}
            {isPinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        )}
        {hasStatusSection && (hasEditSection || hasCopySection) && <DropdownMenuSeparator />}

        {showRename && onRename && (
          <DropdownMenuItem
            disabled={disableRename}
            onSelect={() => {
              onRename()
              onClose()
            }}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {showCreate && onCreate && (
          <DropdownMenuItem
            disabled={disableCreate}
            onSelect={() => {
              onCreate()
              onClose()
            }}
          >
            <Plus />
            Create workflow
          </DropdownMenuItem>
        )}
        {showCreateFolder && onCreateFolder && (
          <DropdownMenuItem
            disabled={disableCreateFolder}
            onSelect={() => {
              onCreateFolder()
              onClose()
            }}
          >
            <FolderPlus />
            Create folder
          </DropdownMenuItem>
        )}
        {showUploadLogo && onUploadLogo && (
          <DropdownMenuItem
            disabled={disableUploadLogo}
            onSelect={() => {
              onUploadLogo()
              onClose()
            }}
          >
            <ImageUp />
            Upload logo
          </DropdownMenuItem>
        )}
        {showLock && onToggleLock && (
          <DropdownMenuItem
            disabled={disableLock}
            onSelect={() => {
              onToggleLock()
              onClose()
            }}
          >
            {isLocked ? <Unlock /> : <Lock />}
            {isLocked ? 'Unlock' : 'Lock'}
          </DropdownMenuItem>
        )}

        {hasEditSection && hasCopySection && <DropdownMenuSeparator />}
        {showDuplicate && onDuplicate && (
          <DropdownMenuItem
            disabled={disableDuplicate}
            onSelect={() => {
              onDuplicate()
              onClose()
            }}
          >
            <Duplicate />
            Duplicate
          </DropdownMenuItem>
        )}
        {showExport && onExport && (
          <DropdownMenuItem
            disabled={disableExport}
            onSelect={() => {
              onExport()
              onClose()
            }}
          >
            <Download />
            Export
          </DropdownMenuItem>
        )}

        {(hasNavigationSection || hasStatusSection || hasEditSection || hasCopySection) &&
          (showLeave || showDelete) && <DropdownMenuSeparator />}
        {showLeave && onLeave && (
          <DropdownMenuItem
            disabled={disableLeave}
            onSelect={() => {
              onLeave()
              onClose()
            }}
          >
            <LogOut />
            Leave
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem
            disabled={disableDelete}
            onSelect={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
