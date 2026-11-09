'use client'

import type { RefObject } from 'react'
import { type MenuAction, PointActionMenu } from '@sim/emcn/menu/action-menu'
import { TriggerUtils } from '@/platform/lib/data/workflows'

/**
 * Block information for context menu actions
 */
interface BlockInfo {
  id: string
  type: string
  enabled: boolean
  parentId?: string
  parentType?: string
  locked?: boolean
  isParentLocked?: boolean
  isParentDisabled?: boolean
}

/**
 * Props for BlockMenu component
 */
interface BlockMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  selectedBlocks: BlockInfo[]
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onRemoveFromSubflow: () => void
  onOpenEditor: () => void
  onRename: () => void
  /** Prompts for an image and appends it to the note. Note blocks only. */
  onAddImage: () => void
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
 * Context menu for workflow block(s), opened at the right-click position. Supports multi-selection:
 * actions apply to all selected blocks. Rows, labels, shortcuts and enabled rules are the legacy
 * menu's; a divider there is `separatorBefore` on the row that follows it here.
 */
export function BlockMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  selectedBlocks,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onDelete,
  onToggleEnabled,
  onRemoveFromSubflow,
  onOpenEditor,
  onRename,
  onAddImage,
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

  const buildActions = (): MenuAction[] => {
    const actions: MenuAction[] = []
    let dividerPending = false
    const divider = () => {
      dividerPending = true
    }
    const add = (action: MenuAction) => {
      actions.push(
        dividerPending && actions.length > 0 ? { ...action, separatorBefore: true } : action
      )
      dividerPending = false
    }

    /* Clipboard actions */
    add({
      id: 'copy',
      label: 'Copy',
      shortcut: '⌘C',
      onSelect: () => {
        onCopy()
        onClose()
      },
    })
    add({
      id: 'cut',
      label: 'Cut',
      shortcut: '⌘X',
      disabled: disableEdit,
      onSelect: () => {
        onCut()
        onClose()
      },
    })
    add({
      id: 'paste',
      label: 'Paste',
      shortcut: '⌘V',
      disabled: !userCanEdit || !hasClipboard,
      onSelect: () => {
        onPaste()
        onClose()
      },
    })
    if (!hasSingletonBlock) {
      add({
        id: 'duplicate',
        label: 'Duplicate',
        disabled: disableEdit,
        onSelect: () => {
          onDuplicate()
          onClose()
        },
      })
    }

    /* Toggle and edit actions */
    if (!allNoteBlocks) {
      divider()
      add({
        id: 'toggle-enabled',
        label: hasBlockWithDisabledParent ? 'Parent is disabled' : getToggleEnabledLabel(),
        disabled: disableEdit || hasBlockWithDisabledParent,
        onSelect: () => {
          if (!disableEdit && !hasBlockWithDisabledParent) {
            onToggleEnabled()
            onClose()
          }
        },
      })
    }
    if (canRemoveFromSubflow) {
      add({
        id: 'remove-from-subflow',
        label: 'Remove from Subflow',
        disabled: disableEdit,
        onSelect: () => {
          onRemoveFromSubflow()
          onClose()
        },
      })
    }
    if (canAdmin && onToggleLocked) {
      add({
        id: 'toggle-locked',
        label: hasBlockWithLockedParent ? 'Parent is locked' : getToggleLockedLabel(),
        disabled: hasBlockWithLockedParent,
        onSelect: () => {
          if (!hasBlockWithLockedParent) {
            onToggleLocked()
            onClose()
          }
        },
      })
    }

    /* Single block actions */
    if (isSingleBlock) divider()
    if (isSingleBlock && !isSubflow) {
      add({
        id: 'rename',
        label: 'Rename',
        disabled: disableEdit,
        onSelect: () => {
          onRename()
          onClose()
        },
      })
    }
    if (isSingleBlock && allNoteBlocks) {
      add({
        id: 'add-image',
        label: 'Add Image',
        disabled: disableEdit,
        onSelect: () => {
          onAddImage()
          onClose()
        },
      })
    }
    /* Not for a note: the panel editor renders nothing for one and clears it again, so the item
       would open an empty editor. */
    if (isSingleBlock && !allNoteBlocks) {
      add({
        id: 'open-editor',
        label: 'Open Editor',
        onSelect: () => {
          onOpenEditor()
          onClose()
        },
      })
    }

    /* Run from/until block - only for single non-note block, not inside subflows */
    if (isSingleBlock && !allNoteBlocks && !isInsideSubflow) {
      divider()
      add({
        id: 'run-from-block',
        label: 'Run from block',
        disabled: !canRunFromBlock || isExecuting,
        onSelect: () => {
          if (canRunFromBlock && !isExecuting) {
            onRunFromBlock?.()
            onClose()
          }
        },
      })
      /* Hide "Run until" for triggers - they're always at the start */
      if (!hasTriggerBlock) {
        add({
          id: 'run-until-block',
          label: 'Run until block',
          disabled: isExecuting,
          onSelect: () => {
            if (!isExecuting) {
              onRunUntilBlock?.()
              onClose()
            }
          },
        })
      }
    }

    /* Destructive action */
    divider()
    add({
      id: 'delete',
      label: 'Delete',
      shortcut: '⌫',
      destructive: true,
      disabled: disableEdit,
      onSelect: () => {
        onDelete()
        onClose()
      },
    })

    return actions
  }

  return (
    <PointActionMenu
      label={isSingleBlock ? 'Block actions' : 'Selected blocks actions'}
      point={isOpen ? position : null}
      popupRef={menuRef}
      onClose={onClose}
      actions={buildActions}
    />
  )
}
