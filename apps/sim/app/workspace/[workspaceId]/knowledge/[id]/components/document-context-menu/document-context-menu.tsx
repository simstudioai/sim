'use client'

import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Eye, Pencil, Plus, SquareArrowUpRight, TagIcon, Trash } from '@/components/emcn/icons'

interface DocumentContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onOpenSource?: () => void
  onRename?: () => void
  onToggleEnabled?: () => void
  onViewTags?: () => void
  onDelete?: () => void
  onAddDocument?: () => void
  isDocumentEnabled?: boolean
  hasDocument: boolean
  hasTags?: boolean
  disableRename?: boolean
  disableToggleEnabled?: boolean
  disableDelete?: boolean
  disableAddDocument?: boolean
  selectedCount?: number
  enabledCount?: number
  disabledCount?: number
}

/**
 * Context menu for documents table.
 * Shows document actions when right-clicking a row, or "Add Document" when right-clicking empty space.
 * Supports batch operations when multiple documents are selected.
 */
export function DocumentContextMenu({
  isOpen,
  position,
  onClose,
  onOpenInNewTab,
  onOpenSource,
  onRename,
  onToggleEnabled,
  onViewTags,
  onDelete,
  onAddDocument,
  isDocumentEnabled = true,
  hasDocument,
  hasTags = false,
  disableRename = false,
  disableToggleEnabled = false,
  disableDelete = false,
  disableAddDocument = false,
  selectedCount = 1,
  enabledCount = 0,
  disabledCount = 0,
}: DocumentContextMenuProps) {
  const t = useTranslations('auto')
  const isMultiSelect = selectedCount > 1

  const getToggleLabel = () => {
    if (isMultiSelect) {
      if (disabledCount > 0) return 'Enable'
      return 'Disable'
    }
    return isDocumentEnabled ? 'Disable' : 'Enable'
  }

  const hasNavigationSection = !isMultiSelect && (!!onOpenInNewTab || !!onOpenSource)
  const hasEditSection = !isMultiSelect && (!!onRename || (hasTags && !!onViewTags))
  const hasStateSection = !!onToggleEnabled
  const hasDestructiveSection = !!onDelete

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
        {hasDocument ? (
          <>
            {!isMultiSelect && onOpenInNewTab && (
              <DropdownMenuItem onSelect={onOpenInNewTab}>
                <SquareArrowUpRight />
                {t('open_in_new_tab')}
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onOpenSource && (
              <DropdownMenuItem onSelect={onOpenSource}>
                <SquareArrowUpRight />
                {t('open_source')}
              </DropdownMenuItem>
            )}
            {hasNavigationSection &&
              (hasEditSection || hasStateSection || hasDestructiveSection) && (
                <DropdownMenuSeparator />
              )}

            {!isMultiSelect && onRename && (
              <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
                <Pencil />
                {t('rename')}
              </DropdownMenuItem>
            )}
            {!isMultiSelect && hasTags && onViewTags && (
              <DropdownMenuItem onSelect={onViewTags}>
                <TagIcon />
                {t('view_tags')}
              </DropdownMenuItem>
            )}
            {hasEditSection && (hasStateSection || hasDestructiveSection) && (
              <DropdownMenuSeparator />
            )}

            {onToggleEnabled && (
              <DropdownMenuItem disabled={disableToggleEnabled} onSelect={onToggleEnabled}>
                <Eye />
                {getToggleLabel()}
              </DropdownMenuItem>
            )}

            {hasStateSection && hasDestructiveSection && <DropdownMenuSeparator />}
            {onDelete && (
              <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
                <Trash />
                {t('delete')}
              </DropdownMenuItem>
            )}
          </>
        ) : (
          onAddDocument && (
            <DropdownMenuItem disabled={disableAddDocument} onSelect={onAddDocument}>
              <Plus />
              {t('add_document')}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
