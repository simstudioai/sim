'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Duplicate, Eye, Pencil, Plus, SquareArrowUpRight, Trash } from '@sim/emcn/icons'
import { useTranslations } from 'next-intl'

interface ChunkContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onEdit?: () => void
  onCopyContent?: () => void
  onToggleEnabled?: () => void
  onDelete?: () => void
  onAddChunk?: () => void
  isChunkEnabled?: boolean
  hasChunk: boolean
  disableToggleEnabled?: boolean
  disableDelete?: boolean
  disableAddChunk?: boolean
  disableEdit?: boolean
  isConnectorDocument?: boolean
  selectedCount?: number
  enabledCount?: number
  disabledCount?: number
}

/**
 * Context menu for chunks table.
 * Shows chunk actions when right-clicking a row, or "Create chunk" when right-clicking empty space.
 * Supports batch operations when multiple chunks are selected.
 */
export function ChunkContextMenu({
  isOpen,
  position,
  onClose,
  onOpenInNewTab,
  onEdit,
  onCopyContent,
  onToggleEnabled,
  onDelete,
  onAddChunk,
  isChunkEnabled = true,
  hasChunk,
  disableToggleEnabled = false,
  disableDelete = false,
  disableAddChunk = false,
  disableEdit = false,
  isConnectorDocument = false,
  selectedCount = 1,
  enabledCount = 0,
  disabledCount = 0,
}: ChunkContextMenuProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const isMultiSelect = selectedCount > 1

  const getToggleLabel = () => {
    if (isMultiSelect) {
      if (disabledCount > 0) return 'Enable'
      return 'Disable'
    }
    return isChunkEnabled ? 'Disable' : 'Enable'
  }

  const hasNavigationSection = !isMultiSelect && !!onOpenInNewTab
  const hasEditSection = !isMultiSelect && (!!onEdit || !!onCopyContent)
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
        {hasChunk ? (
          <>
            {hasNavigationSection && (
              <DropdownMenuItem onSelect={onOpenInNewTab!}>
                <SquareArrowUpRight />
                {t('open_in_new_tab')}
              </DropdownMenuItem>
            )}
            {hasNavigationSection &&
              (hasEditSection || hasStateSection || hasDestructiveSection) && (
                <DropdownMenuSeparator />
              )}

            {!isMultiSelect && onEdit && (
              <DropdownMenuItem disabled={disableEdit} onSelect={onEdit}>
                <Pencil />
                {isConnectorDocument ? tI18n('view') : tI18n('edit')}
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onCopyContent && (
              <DropdownMenuItem onSelect={onCopyContent}>
                <Duplicate />
                {t('copy_content')}
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
          onAddChunk && (
            <DropdownMenuItem disabled={disableAddChunk} onSelect={onAddChunk}>
              <Plus />
              {t('create_chunk')}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
