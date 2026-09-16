'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Eye, Pencil, Plus, RefreshCw, SquareArrowUpRight, TagIcon, Trash } from '@sim/emcn/icons'
import {
  selectionActionLabel,
  selectionToggleActionLabel,
} from '@/app/workspace/[workspaceId]/components/resource/selection-label'

interface DocumentContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpenInNewTab?: () => void
  onOpenSource?: () => void
  onRename?: () => void
  onToggleEnabled?: () => void
  onViewTags?: () => void
  onRetry?: () => void
  onDelete?: () => void
  onAddDocument?: () => void
  isDocumentEnabled?: boolean
  hasDocument: boolean
  disableRename?: boolean
  disableToggleEnabled?: boolean
  disableDelete?: boolean
  disableAddDocument?: boolean
  selectedCount: number
  enabledCount?: number
  disabledCount?: number
  hasExactToggleCount?: boolean
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
  onRetry,
  onDelete,
  onAddDocument,
  isDocumentEnabled = true,
  hasDocument,
  disableRename = false,
  disableToggleEnabled = false,
  disableDelete = false,
  disableAddDocument = false,
  selectedCount,
  enabledCount = 0,
  disabledCount = 0,
  hasExactToggleCount = true,
}: DocumentContextMenuProps) {
  const isMultiSelect = selectedCount > 1
  const toggleLabel = selectionToggleActionLabel({
    selectedCount,
    enabledCount,
    disabledCount,
    isSelectedItemEnabled: isDocumentEnabled,
    hasExactAffectedCount: hasExactToggleCount,
  })

  const hasNavigationSection = !isMultiSelect && (!!onOpenInNewTab || !!onOpenSource)
  const hasEditSection = !isMultiSelect && (!!onRename || !!onViewTags)
  const hasStateSection = !!onToggleEnabled || (!isMultiSelect && !!onRetry)
  const hasDestructiveSection = !!onDelete
  const hasActionsAboveDestructive = hasNavigationSection || hasEditSection || hasStateSection

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
                Open in new tab
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onOpenSource && (
              <DropdownMenuItem onSelect={onOpenSource}>
                <SquareArrowUpRight />
                Open source
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onRename && (
              <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onViewTags && (
              <DropdownMenuItem onSelect={onViewTags}>
                <TagIcon />
                Tags
              </DropdownMenuItem>
            )}
            {onToggleEnabled && (
              <DropdownMenuItem disabled={disableToggleEnabled} onSelect={onToggleEnabled}>
                <Eye />
                {toggleLabel}
              </DropdownMenuItem>
            )}
            {!isMultiSelect && onRetry && (
              <DropdownMenuItem onSelect={onRetry}>
                <RefreshCw />
                Retry
              </DropdownMenuItem>
            )}

            {hasActionsAboveDestructive && hasDestructiveSection && <DropdownMenuSeparator />}
            {onDelete && (
              <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
                <Trash />
                {selectionActionLabel('Delete', selectedCount)}
              </DropdownMenuItem>
            )}
          </>
        ) : (
          onAddDocument && (
            <DropdownMenuItem disabled={disableAddDocument} onSelect={onAddDocument}>
              <Plus />
              New documents
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
