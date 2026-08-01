'use client'

import { memo } from 'react'
import { DropdownMenuItem } from '@sim/emcn'
import { FolderPlus, Plus } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface KnowledgeListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onAddKnowledgeBase?: () => void
  onAddFolder?: () => void
  disableAdd?: boolean
  disableAddFolder?: boolean
}

/**
 * Context menu component for the knowledge base list page.
 * Displays the create actions when right-clicking on empty space.
 */
export const KnowledgeListContextMenu = memo(function KnowledgeListContextMenu({
  isOpen,
  position,
  onClose,
  onAddKnowledgeBase,
  onAddFolder,
  disableAdd = false,
  disableAddFolder = false,
}: KnowledgeListContextMenuProps) {
  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {onAddKnowledgeBase && (
        <DropdownMenuItem disabled={disableAdd} onSelect={onAddKnowledgeBase}>
          <Plus />
          Add knowledge base
        </DropdownMenuItem>
      )}
      {onAddFolder && (
        <DropdownMenuItem disabled={disableAddFolder} onSelect={onAddFolder}>
          <FolderPlus />
          New folder
        </DropdownMenuItem>
      )}
    </AnchoredContextMenu>
  )
})
