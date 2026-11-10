'use client'

import type { RefObject } from 'react'
import { type MenuAction, PointActionMenu } from '@sim/emcn/menu/action-menu'

/**
 * Props for CanvasMenu component
 */
interface CanvasMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onUndo: () => void
  onRedo: () => void
  onPaste: () => void
  onAddBlock: () => void
  onAutoLayout: () => void
  onFitToView: () => void
  onOpenLogs: () => void
  onOpenSearchReplace: () => void
  onToggleVariables: () => void
  onToggleWorkflowLock?: () => void
  isVariablesOpen?: boolean
  hasClipboard?: boolean
  disableEdit?: boolean
  canAdmin?: boolean
  canUndo?: boolean
  canRedo?: boolean
  /** Whether the workflow has locked blocks (disables auto-layout) */
  hasLockedBlocks?: boolean
  /** Whether all blocks in the workflow are locked */
  allBlocksLocked?: boolean
  /** Whether the workflow has any blocks */
  hasBlocks?: boolean
}

/**
 * Context menu for the workflow canvas: canvas-level actions when right-clicking empty space. The
 * legacy rows, shortcuts and enabled rules, without the floating chat's toggle.
 */
export function CanvasMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onUndo,
  onRedo,
  onPaste,
  onAddBlock,
  onAutoLayout,
  onFitToView,
  onOpenLogs,
  onOpenSearchReplace,
  onToggleVariables,
  onToggleWorkflowLock,
  isVariablesOpen = false,
  hasClipboard = false,
  disableEdit = false,
  canAdmin = false,
  canUndo = false,
  canRedo = false,
  hasLockedBlocks = false,
  allBlocksLocked = false,
  hasBlocks = false,
}: CanvasMenuProps) {
  const buildActions = (): MenuAction[] => {
    const actions: MenuAction[] = [
      // History actions
      {
        id: 'undo',
        label: 'Undo',
        shortcut: '⌘Z',
        disabled: disableEdit || !canUndo,
        onSelect: () => {
          onUndo()
          onClose()
        },
      },
      {
        id: 'redo',
        label: 'Redo',
        shortcut: '⌘⇧Z',
        disabled: disableEdit || !canRedo,
        onSelect: () => {
          onRedo()
          onClose()
        },
      },
      {
        id: 'paste',
        label: 'Paste',
        shortcut: '⌘V',
        disabled: disableEdit || !hasClipboard,
        onSelect: () => {
          onPaste()
          onClose()
        },
      },
      // Edit and creation actions
      {
        id: 'add-block',
        label: 'Add block',
        shortcut: '⌘⌥F',
        separatorBefore: true,
        disabled: disableEdit,
        onSelect: () => {
          onAddBlock()
          onClose()
        },
      },
      {
        id: 'auto-layout',
        label: 'Auto-layout',
        shortcut: '⇧L',
        disabled: disableEdit || hasLockedBlocks,
        disabledReason: hasLockedBlocks ? 'Unlock blocks to use auto-layout' : undefined,
        onSelect: () => {
          onAutoLayout()
          onClose()
        },
      },
    ]
    if (canAdmin && onToggleWorkflowLock) {
      actions.push({
        id: 'toggle-workflow-lock',
        label: allBlocksLocked ? 'Unlock workflow' : 'Lock workflow',
        disabled: !hasBlocks,
        onSelect: () => {
          onToggleWorkflowLock()
          onClose()
        },
      })
    }
    actions.push(
      {
        id: 'fit-to-view',
        label: 'Fit to view',
        onSelect: () => {
          onFitToView()
          onClose()
        },
      },
      // Navigation actions
      {
        id: 'search-replace',
        label: 'Search and replace',
        shortcut: '⌘F',
        separatorBefore: true,
        onSelect: () => {
          onOpenSearchReplace()
          onClose()
        },
      },
      {
        id: 'open-logs',
        label: 'Open logs',
        shortcut: '⌘L',
        onSelect: () => {
          onOpenLogs()
          onClose()
        },
      },
      {
        id: 'toggle-variables',
        label: isVariablesOpen ? 'Close variables' : 'Open variables',
        onSelect: () => {
          onToggleVariables()
          onClose()
        },
      }
    )
    return actions
  }

  return (
    <PointActionMenu
      label='Canvas actions'
      point={isOpen ? position : null}
      popupRef={menuRef}
      onClose={onClose}
      actions={buildActions}
    />
  )
}
