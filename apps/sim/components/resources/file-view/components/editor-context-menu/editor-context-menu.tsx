'use client'

import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@sim/emcn'
import { Clipboard, Duplicate, Search, SelectAll } from '@sim/emcn/icons'
import { Scissors } from 'lucide-react'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface EditorContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  hasSelection: boolean
  canEdit: boolean
  onCut: () => void
  onCopy: () => void
  onCopyAll: () => void
  onPaste: () => void
  onSelectAll: () => void
  onFind: () => void
}

export function EditorContextMenu({
  isOpen,
  position,
  onClose,
  hasSelection,
  canEdit,
  onCut,
  onCopy,
  onCopyAll,
  onPaste,
  onSelectAll,
  onFind,
}: EditorContextMenuProps) {
  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose} sideOffset={2}>
      {canEdit && (
        <DropdownMenuItem disabled={!hasSelection} onSelect={onCut}>
          <Scissors />
          Cut
          <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem disabled={!hasSelection} onSelect={onCopy}>
        <Duplicate />
        Copy
        <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onCopyAll}>
        <Duplicate />
        Copy all
      </DropdownMenuItem>
      {canEdit && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onPaste}>
            <Clipboard />
            Paste
            <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSelectAll}>
        <SelectAll />
        Select all
        <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onFind}>
        <Search />
        Find
        <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
      </DropdownMenuItem>
    </AnchoredContextMenu>
  )
}
