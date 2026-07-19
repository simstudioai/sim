'use client'

import { memo } from 'react'
import { DropdownMenuItem } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface KnowledgeListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onAddKnowledgeBase?: () => void
  disableAdd?: boolean
}

/**
 * Context menu component for the knowledge base list page.
 * Displays "Add knowledge base" option when right-clicking on empty space.
 */
export const KnowledgeListContextMenu = memo(function KnowledgeListContextMenu({
  isOpen,
  position,
  onClose,
  onAddKnowledgeBase,
  disableAdd = false,
}: KnowledgeListContextMenuProps) {
  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      {onAddKnowledgeBase && (
        <DropdownMenuItem disabled={disableAdd} onSelect={onAddKnowledgeBase}>
          <Plus />
          Add knowledge base
        </DropdownMenuItem>
      )}
    </AnchoredContextMenu>
  )
})
