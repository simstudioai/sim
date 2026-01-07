import type { RefObject } from 'react'

/**
 * Position for context menu placement
 */
export interface ContextMenuPosition {
  x: number
  y: number
}

/**
 * Block information passed to context menu for action handling
 */
export interface ContextMenuBlockInfo {
  /** Block ID */
  id: string
  /** Block type (e.g., 'agent', 'function', 'loop') */
  type: string
  /** Whether block is enabled */
  enabled: boolean
  /** Whether block uses horizontal handles */
  horizontalHandles: boolean
  /** Parent subflow ID if nested in loop/parallel */
  parentId?: string
  /** Parent type ('loop' | 'parallel') if nested */
  parentType?: string
}

/**
 * Props for BlockContextMenu component
 */
export interface BlockContextMenuProps {
  /** Whether the context menu is open */
  isOpen: boolean
  /** Position of the context menu */
  position: ContextMenuPosition
  /** Ref for the menu element (for click-outside detection) */
  menuRef: RefObject<HTMLDivElement | null>
  /** Callback when menu should close */
  onClose: () => void
  /** Selected block(s) info */
  selectedBlocks: ContextMenuBlockInfo[]
  /** Callbacks for menu actions */
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onToggleHandles: () => void
  onRemoveFromSubflow: () => void
  onOpenEditor: () => void
  onRename: () => void
  /** Whether clipboard has content for pasting */
  hasClipboard?: boolean
  /** Whether remove from subflow option should be shown */
  showRemoveFromSubflow?: boolean
  /** Whether edit actions are disabled (no permission) */
  disableEdit?: boolean
}

/**
 * Props for PaneContextMenu component
 */
export interface PaneContextMenuProps {
  /** Whether the context menu is open */
  isOpen: boolean
  /** Position of the context menu */
  position: ContextMenuPosition
  /** Ref for the menu element */
  menuRef: RefObject<HTMLDivElement | null>
  /** Callback when menu should close */
  onClose: () => void
  /** Callbacks for menu actions */
  onUndo: () => void
  onRedo: () => void
  onPaste: () => void
  onAddBlock: () => void
  onAutoLayout: () => void
  onOpenLogs: () => void
  onToggleVariables: () => void
  onToggleChat: () => void
  onInvite: () => void
  /** Whether the variables panel is currently open */
  isVariablesOpen?: boolean
  /** Whether the chat panel is currently open */
  isChatOpen?: boolean
  /** Whether clipboard has content for pasting */
  hasClipboard?: boolean
  /** Whether edit actions are disabled (no permission) */
  disableEdit?: boolean
  /** Whether admin actions are disabled (no admin permission) */
  disableAdmin?: boolean
  /** Whether undo is available */
  canUndo?: boolean
  /** Whether redo is available */
  canRedo?: boolean
}
