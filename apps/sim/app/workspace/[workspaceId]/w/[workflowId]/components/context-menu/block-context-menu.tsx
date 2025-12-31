'use client'

import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import type { BlockContextMenuProps } from './types'

/**
 * Context menu for workflow block(s).
 * Displays block-specific actions in a popover at right-click position.
 * Supports multi-selection - actions apply to all selected blocks.
 */
export function BlockContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  selectedBlocks,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onToggleEnabled,
  onToggleHandles,
  onRemoveFromSubflow,
  onOpenEditor,
  onRename,
  hasClipboard = false,
  showRemoveFromSubflow = false,
  disableEdit = false,
}: BlockContextMenuProps) {
  const isSingleBlock = selectedBlocks.length === 1

  const allEnabled = selectedBlocks.every((b) => b.enabled)
  const allDisabled = selectedBlocks.every((b) => !b.enabled)

  const hasStarterBlock = selectedBlocks.some(
    (b) => b.type === 'starter' || b.type === 'start_trigger'
  )
  const allNoteBlocks = selectedBlocks.every((b) => b.type === 'note')
  const isSubflow =
    isSingleBlock && (selectedBlocks[0]?.type === 'loop' || selectedBlocks[0]?.type === 'parallel')

  const canRemoveFromSubflow = showRemoveFromSubflow && !hasStarterBlock

  const getToggleEnabledLabel = () => {
    if (allEnabled) return 'Disable'
    if (allDisabled) return 'Enable'
    return 'Toggle Enabled'
  }

  return (
    <Popover open={isOpen} onOpenChange={onClose} variant='secondary' size='sm'>
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        {/* Copy */}
        <PopoverItem
          className='group'
          onClick={() => {
            onCopy()
            onClose()
          }}
        >
          <span>Copy</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘C</span>
        </PopoverItem>

        {/* Paste */}
        <PopoverItem
          className='group'
          disabled={disableEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>Paste</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌘V</span>
        </PopoverItem>

        {/* Duplicate - hide for starter blocks */}
        {!hasStarterBlock && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onDuplicate()
              onClose()
            }}
          >
            Duplicate
          </PopoverItem>
        )}

        {/* Delete */}
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          <span>Delete</span>
          <span className='ml-auto text-[var(--text-tertiary)] group-hover:text-inherit'>⌫</span>
        </PopoverItem>

        {/* Enable/Disable - hide if all blocks are notes */}
        {!allNoteBlocks && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onToggleEnabled()
              onClose()
            }}
          >
            {getToggleEnabledLabel()}
          </PopoverItem>
        )}

        {/* Flip Handles - hide if all blocks are notes */}
        {!allNoteBlocks && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onToggleHandles()
              onClose()
            }}
          >
            Flip Handles
          </PopoverItem>
        )}

        {/* Remove from Subflow - only show when applicable */}
        {canRemoveFromSubflow && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onRemoveFromSubflow()
              onClose()
            }}
          >
            Remove from Subflow
          </PopoverItem>
        )}

        {/* Rename - only for single block, not subflows */}
        {isSingleBlock && !isSubflow && (
          <PopoverItem
            disabled={disableEdit}
            onClick={() => {
              onRename()
              onClose()
            }}
          >
            Rename
          </PopoverItem>
        )}

        {/* Open Editor - only for single block */}
        {isSingleBlock && (
          <PopoverItem
            onClick={() => {
              onOpenEditor()
              onClose()
            }}
          >
            Open Editor
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
