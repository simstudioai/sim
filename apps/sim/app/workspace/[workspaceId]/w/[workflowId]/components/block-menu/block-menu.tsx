'use client'

import type { RefObject } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'

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
  locked?: boolean
  isParentLocked?: boolean
  isParentDisabled?: boolean
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
  onRunFromBlock?: () => void
  onRunUntilBlock?: () => void
  hasClipboard?: boolean
  showRemoveFromSubflow?: boolean
  /** Whether run from block is available (has snapshot, was executed, not inside subflow) */
  canRunFromBlock?: boolean
  /** Whether to disable edit actions (user can't edit OR blocks are locked) */
  disableEdit?: boolean
  /** Whether the user has edit permission (ignoring locked state) */
  userCanEdit?: boolean
  isExecuting?: boolean
  /** Whether the selected block is a trigger (has no incoming edges) */
  isPositionalTrigger?: boolean
  /** Callback to toggle locked state of selected blocks */
  onToggleLocked?: () => void
  /** Whether the user has admin permissions */
  canAdmin?: boolean
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
  onRunFromBlock,
  onRunUntilBlock,
  hasClipboard = false,
  showRemoveFromSubflow = false,
  canRunFromBlock = false,
  disableEdit = false,
  userCanEdit = true,
  isExecuting = false,
  isPositionalTrigger = false,
  onToggleLocked,
  canAdmin = false,
}: BlockMenuProps) {
  const isSingleBlock = selectedBlocks.length === 1

  const allEnabled = selectedBlocks.every((b) => b.enabled)
  const allDisabled = selectedBlocks.every((b) => !b.enabled)
  const allLocked = selectedBlocks.every((b) => b.locked)
  const allUnlocked = selectedBlocks.every((b) => !b.locked)
  // Can't unlock blocks that have locked parents
  const hasBlockWithLockedParent = selectedBlocks.some((b) => b.locked && b.isParentLocked)
  // Can't enable blocks that have disabled parents
  const hasBlockWithDisabledParent = selectedBlocks.some((b) => !b.enabled && b.isParentDisabled)

  const hasSingletonBlock = selectedBlocks.some(
    (b) =>
      TriggerUtils.requiresSingleInstance(b.type) || TriggerUtils.isSingleInstanceBlockType(b.type)
  )
  // A block is a trigger if it's explicitly a trigger type OR has no incoming edges (positional trigger)
  const hasTriggerBlock =
    selectedBlocks.some((b) => TriggerUtils.isTriggerBlock(b)) || isPositionalTrigger
  const allNoteBlocks = selectedBlocks.every((b) => b.type === 'note')
  const isSubflow =
    isSingleBlock && (selectedBlocks[0]?.type === 'loop' || selectedBlocks[0]?.type === 'parallel')
  const isInsideSubflow =
    isSingleBlock &&
    (selectedBlocks[0]?.parentType === 'loop' || selectedBlocks[0]?.parentType === 'parallel')

  const canRemoveFromSubflow = showRemoveFromSubflow && !hasTriggerBlock

  const getToggleEnabledLabel = () => {
    if (allEnabled) return 'Disable'
    if (allDisabled) return 'Enable'
    return 'Toggle Enabled'
  }

  const getToggleLockedLabel = () => {
    if (allLocked) return 'Unlock'
    if (allUnlocked) return 'Lock'
    return 'Toggle Lock'
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
          disabled={!userCanEdit || !hasClipboard}
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          <span>Paste</span>
          <span className='ml-auto opacity-70 group-hover:opacity-100'>⌘V</span>
        </PopoverItem>
        {!hasSingletonBlock && (
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
            disabled={disableEdit || hasBlockWithDisabledParent}
            onClick={() => {
              if (!disableEdit && !hasBlockWithDisabledParent) {
                onToggleEnabled()
                onClose()
              }
            }}
          >
            {hasBlockWithDisabledParent ? 'Parent is disabled' : getToggleEnabledLabel()}
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
        {canAdmin && onToggleLocked && (
          <PopoverItem
            disabled={hasBlockWithLockedParent}
            onClick={() => {
              if (!hasBlockWithLockedParent) {
                onToggleLocked()
                onClose()
              }
            }}
          >
            {hasBlockWithLockedParent ? 'Parent is locked' : getToggleLockedLabel()}
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

        {/* Run from/until block - only for single non-note block, not inside subflows */}
        {isSingleBlock && !allNoteBlocks && !isInsideSubflow && (
          <>
            <PopoverDivider />
            <PopoverItem
              disabled={!canRunFromBlock || isExecuting}
              onClick={() => {
                if (canRunFromBlock && !isExecuting) {
                  onRunFromBlock?.()
                  onClose()
                }
              }}
            >
              Run from block
            </PopoverItem>
            {/* Hide "Run until" for triggers - they're always at the start */}
            {!hasTriggerBlock && (
              <PopoverItem
                disabled={isExecuting}
                onClick={() => {
                  if (!isExecuting) {
                    onRunUntilBlock?.()
                    onClose()
                  }
                }}
              >
                Run until block
              </PopoverItem>
            )}
          </>
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
