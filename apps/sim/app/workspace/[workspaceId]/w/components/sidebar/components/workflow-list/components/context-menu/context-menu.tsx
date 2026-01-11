'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverBackButton,
  PopoverContent,
  PopoverDivider,
  PopoverFolder,
  PopoverItem,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { WORKFLOW_COLORS } from '@/lib/workflows/colors'

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
   * Callback when color is changed
   */
  onColorChange?: (color: string) => void
  /**
   * Current workflow color (for showing selected state)
   */
  currentColor?: string
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
   * Whether to show the change color option (default: false)
   * Set to true for workflows to allow color customization
   */
  showColorChange?: boolean
  /**
   * Whether the export option is disabled (default: false)
   * Set to true when user lacks permissions
   */
  disableExport?: boolean
  /**
   * Whether the change color option is disabled (default: false)
   * Set to true when user lacks permissions
   */
  disableColorChange?: boolean
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
  onColorChange,
  currentColor,
  showOpenInNewTab = false,
  showRename = true,
  showCreate = false,
  showCreateFolder = false,
  showDuplicate = true,
  showExport = false,
  showColorChange = false,
  disableExport = false,
  disableColorChange = false,
  disableRename = false,
  disableDuplicate = false,
  disableDelete = false,
  disableCreate = false,
  disableCreateFolder = false,
}: ContextMenuProps) {
  // Section visibility for divider logic
  const hasNavigationSection = showOpenInNewTab && onOpenInNewTab
  const hasEditSection =
    (showRename && onRename) ||
    (showCreate && onCreate) ||
    (showCreateFolder && onCreateFolder) ||
    (showColorChange && onColorChange)
  const hasCopySection = (showDuplicate && onDuplicate) || (showExport && onExport)

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
      <PopoverContent
        ref={menuRef}
        align='start'
        side='bottom'
        sideOffset={4}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Back button - shown only when in a folder */}
        <PopoverBackButton />

        {/* Navigation actions */}
        {showOpenInNewTab && onOpenInNewTab && (
          <PopoverItem
            rootOnly
            onClick={() => {
              onOpenInNewTab()
              onClose()
            }}
          >
            Open in new tab
          </PopoverItem>
        )}
        {hasNavigationSection && (hasEditSection || hasCopySection) && <PopoverDivider rootOnly />}

        {/* Edit and create actions */}
        {showRename && onRename && (
          <PopoverItem
            rootOnly
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
            rootOnly
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
            rootOnly
            disabled={disableCreateFolder}
            onClick={() => {
              onCreateFolder()
              onClose()
            }}
          >
            Create folder
          </PopoverItem>
        )}
        {showColorChange && onColorChange && (
          <PopoverFolder
            id='color-picker'
            title='Change color'
            expandOnHover
            className={disableColorChange ? 'pointer-events-none opacity-50' : ''}
          >
            <div className='grid grid-cols-6 gap-[4px] p-[2px]'>
              {WORKFLOW_COLORS.map(({ color, name }) => (
                <button
                  key={color}
                  type='button'
                  title={name}
                  onClick={(e) => {
                    e.stopPropagation()
                    onColorChange(color)
                  }}
                  className={cn(
                    'h-[20px] w-[20px] rounded-[4px]',
                    currentColor === color && 'ring-1 ring-white'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </PopoverFolder>
        )}

        {/* Copy and export actions */}
        {hasEditSection && hasCopySection && <PopoverDivider rootOnly />}
        {showDuplicate && onDuplicate && (
          <PopoverItem
            rootOnly
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
            rootOnly
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
        {(hasNavigationSection || hasEditSection || hasCopySection) && <PopoverDivider rootOnly />}
        <PopoverItem
          rootOnly
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
