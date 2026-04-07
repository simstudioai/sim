'use client'

import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Plus } from '@/components/emcn/icons'

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
        {onAddKnowledgeBase && (
          <DropdownMenuItem disabled={disableAdd} onSelect={onAddKnowledgeBase}>
            <Plus />
            Add knowledge base
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
