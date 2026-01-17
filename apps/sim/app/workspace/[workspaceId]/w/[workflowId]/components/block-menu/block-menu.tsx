'use client'

import type { RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import { isValidStartBlockType } from '@/lib/workflows/triggers/start-block-types'

/**
 * Block information for context menu actions
 */
export interface BlockInfo {
  id: string
  type: string
  enabled: boolean
  horizontalHandles: boolean
  parentId?: string
  parentType?: string
}

/**
 * Props for BlockMenu component
 */
export interface BlockMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  selectedBlocks: BlockInfo[]
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onToggleHandles: () => void
  onRemoveFromSubflow: () => void
  onOpenEditor: () => void
  onRename: () => void
  hasClipboard?: boolean
  showRemoveFromSubflow?: boolean
  disableEdit?: boolean
}

/**
 * Context menu for workflow block(s).
 * Displays block-specific actions in a popover at right-click position.
 * Supports multi-selection - actions apply to all selected blocks.
 */
export function BlockMenu({
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
}: BlockMenuProps) {
  const isSingleBlock = selectedBlocks.length === 1

  const allEnabled = selectedBlocks.every((b) => b.enabled)
  const allDisabled = selectedBlocks.every((b) => !b.enabled)

  const hasStarterBlock = selectedBlocks.some((b) => isValidStartBlockType(b.type))
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
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
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
        {/* Clipboard actions */}
        <PopoverItem
          className='group'
          onClick={() => {
            onCopy()
            onClose()
          }}
        >
          <span>Copy</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘C</span>
        </PopoverItem>
        <PopoverItem
          className='group'
          disabled={disableEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>Paste</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘V</span>
        </PopoverItem>
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

        {/* Toggle and edit actions */}
        {!allNoteBlocks && <PopoverDivider />}
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
        {!allNoteBlocks && !isSubflow && (
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

        {/* Single block actions */}
        {isSingleBlock && <PopoverDivider />}
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

        {/* Destructive action */}
        <PopoverDivider />
        <PopoverItem
          className='group'
          disabled={disableEdit}
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          <span>Delete</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌫</span>
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
