'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface ContextMenuProps {
  /**
   * Whether the context menu is open
   */
  isOpen: boolean
  /**
   * Position of the context menu
   */
  position: { x: number; y: number }
  /**
   * Ref for the menu element
   */
  menuRef: React.RefObject<HTMLDivElement | null>
  /**
   * Callback when menu should close
   */
  onClose: () => void
  /**
   * Callback when open in new tab is clicked
   */
  onOpenInNewTab?: () => void
  /**
   * Callback when rename is clicked
   */
  onRename?: () => void
  /**
   * Callback when create workflow is clicked (for folders)
   */
  onCreate?: () => void
  /**
   * Callback when create folder is clicked (for folders)
   */
  onCreateFolder?: () => void
  /**
   * Callback when duplicate is clicked
   */
  onDuplicate?: () => void
  /**
   * Callback when export is clicked
   */
  onExport?: () => void
  /**
   * Callback when delete is clicked
   */
  onDelete: () => void
  /**
   * Whether to show the open in new tab option (default: false)
   * Set to true for items that can be opened in a new tab
   */
  showOpenInNewTab?: boolean
  /**
   * Whether to show the rename option (default: true)
   * Set to false when multiple items are selected
   */
  showRename?: boolean
  /**
   * Whether to show the create workflow option (default: false)
   * Set to true for folders to create workflows inside
   */
  showCreate?: boolean
  /**
   * Whether to show the create folder option (default: false)
   * Set to true for folders to create sub-folders inside
   */
  showCreateFolder?: boolean
  /**
   * Whether to show the duplicate option (default: true)
   * Set to false for items that cannot be duplicated
   */
  showDuplicate?: boolean
  /**
   * Whether to show the export option (default: false)
   * Set to true for items that can be exported (like workspaces)
   */
  showExport?: boolean
  /**
   * Whether the export option is disabled (default: false)
   * Set to true when user lacks permissions
   */
  disableExport?: boolean
  /**
   * Whether the rename option is disabled (default: false)
   * Set to true when user lacks permissions
   */
  disableRename?: boolean
  /**
   * Whether the duplicate option is disabled (default: false)
   * Set to true when user lacks permissions
   */
  disableDuplicate?: boolean
  /**
   * Whether the delete option is disabled (default: false)
   * Set to true when user lacks permissions
   */
  disableDelete?: boolean
  /**
   * Whether the create workflow option is disabled (default: false)
   * Set to true when creation is in progress or user lacks permissions
   */
  disableCreate?: boolean
  /**
   * Whether the create folder option is disabled (default: false)
   * Set to true when creation is in progress or user lacks permissions
   */
  disableCreateFolder?: boolean
}

/**
 * Context menu component for workflow, folder, and workspace items.
 * Displays context-appropriate options (rename, duplicate, export, delete) in a popover at the right-click position.
 *
 * @param props - Component props
 * @returns Context menu popover
 */
export function ContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onOpenInNewTab,
  onRename,
  onCreate,
  onCreateFolder,
  onDuplicate,
  onExport,
  onDelete,
  showOpenInNewTab = false,
  showRename = true,
  showCreate = false,
  showCreateFolder = false,
  showDuplicate = true,
  showExport = false,
  disableExport = false,
  disableRename = false,
  disableDuplicate = false,
  disableDelete = false,
  disableCreate = false,
  disableCreateFolder = false,
}: ContextMenuProps) {
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
        {/* Navigation actions */}
        {showOpenInNewTab && onOpenInNewTab && (
          <PopoverItem
            onClick={() => {
              onOpenInNewTab()
              onClose()
            }}
          >
            Open in new tab
          </PopoverItem>
        )}
        {showOpenInNewTab && onOpenInNewTab && <PopoverDivider />}

        {/* Edit and create actions */}
        {showRename && onRename && (
          <PopoverItem
            disabled={disableRename}
            onClick={() => {
              onRename()
              onClose()
            }}
          >
            Rename
          </PopoverItem>
        )}
        {showCreate && onCreate && (
          <PopoverItem
            disabled={disableCreate}
            onClick={() => {
              onCreate()
              onClose()
            }}
          >
            Create workflow
          </PopoverItem>
        )}
        {showCreateFolder && onCreateFolder && (
          <PopoverItem
            disabled={disableCreateFolder}
            onClick={() => {
              onCreateFolder()
              onClose()
            }}
          >
            Create folder
          </PopoverItem>
        )}

        {/* Copy and export actions */}
        {(showDuplicate || showExport) && <PopoverDivider />}
        {showDuplicate && onDuplicate && (
          <PopoverItem
            disabled={disableDuplicate}
            onClick={() => {
              onDuplicate()
              onClose()
            }}
          >
            Duplicate
          </PopoverItem>
        )}
        {showExport && onExport && (
          <PopoverItem
            disabled={disableExport}
            onClick={() => {
              onExport()
              onClose()
            }}
          >
            Export
          </PopoverItem>
        )}

        {/* Destructive action */}
        <PopoverDivider />
        <PopoverItem
          disabled={disableDelete}
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          Delete
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
