'use client'

import { memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Duplicate, Pencil, SquareArrowUpRight, TagIcon, Trash } from '@/components/emcn/icons'
import { useTranslations } from 'next-intl'

interface KnowledgeBaseContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onViewTags?: () => void
  onCopyId?: () => void
  onEdit?: () => void
  onDelete?: () => void
  showOpenInNewTab?: boolean
  showViewTags?: boolean
  showEdit?: boolean
  showDelete?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
}

/**
 * Context menu component for knowledge base cards.
 * Displays open in new tab, view tags, edit, and delete options.
 */
export const KnowledgeBaseContextMenu = memo(function KnowledgeBaseContextMenu({
  isOpen,
  position,
  onClose,
  onOpenInNewTab,
  onViewTags,
  onCopyId,
  onEdit,
  onDelete,
  showOpenInNewTab = true,
  showViewTags = true,
  showEdit = true,
  showDelete = true,
  disableEdit = false,
  disableDelete = false,
}: KnowledgeBaseContextMenuProps) {
  const t = useTranslations('auto')
  const hasNavigationSection = showOpenInNewTab && !!onOpenInNewTab
  const hasInfoSection = (showViewTags && !!onViewTags) || !!onCopyId
  const hasEditSection = showEdit && !!onEdit
  const hasDestructiveSection = showDelete && !!onDelete

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
        {hasNavigationSection && (
          <DropdownMenuItem onSelect={onOpenInNewTab!}>
            <SquareArrowUpRight />
            {t('open_in_new_tab')}
          </DropdownMenuItem>
        )}
        {hasNavigationSection && (hasInfoSection || hasEditSection || hasDestructiveSection) && (
          <DropdownMenuSeparator />
        )}

        {showViewTags && onViewTags && (
          <DropdownMenuItem onSelect={onViewTags}>
            <TagIcon />
            {t('view_tags')}
          </DropdownMenuItem>
        )}
        {onCopyId && (
          <DropdownMenuItem onSelect={onCopyId}>
            <Duplicate />
            {t('copy_id')}
          </DropdownMenuItem>
        )}
        {hasInfoSection && (hasEditSection || hasDestructiveSection) && <DropdownMenuSeparator />}

        {showEdit && onEdit && (
          <DropdownMenuItem disabled={disableEdit} onSelect={onEdit}>
            <Pencil />
            {t('edit')}
          </DropdownMenuItem>
        )}

        {hasEditSection && hasDestructiveSection && <DropdownMenuSeparator />}
        {showDelete && onDelete && (
          <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
            <Trash />
            {t('delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
