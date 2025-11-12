'use client'

import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/workflow-list/components/delete-modal/delete-modal'
import {
  useContextMenu,
  useFolderExpand,
  useItemDrag,
  useItemRename,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useDeleteFolder, useDuplicateFolder } from '@/app/workspace/[workspaceId]/w/hooks'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface FolderItemProps {
  folder: FolderTreeNode
  level: number
  hoverHandlers?: {
    onDragEnter?: (e: React.DragEvent<HTMLElement>) => void
    onDragLeave?: (e: React.DragEvent<HTMLElement>) => void
  }
}

/**
 * FolderItem component displaying a single folder with drag and expand/collapse support.
 * Uses item drag and folder expand hooks for unified behavior.
 * Supports hover-to-expand during drag operations via hoverHandlers.
 *
 * @param props - Component props
 * @returns Folder item with drag and expand support
 */
export function FolderItem({ folder, level, hoverHandlers }: FolderItemProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const { updateFolderAPI } = useFolderStore()
  const { createWorkflow } = useWorkflowRegistry()

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Delete folder hook
  const { isDeleting, handleDeleteFolder } = useDeleteFolder({
    workspaceId,
    getFolderIds: () => folder.id,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  // Duplicate folder hook
  const { handleDuplicateFolder } = useDuplicateFolder({
    workspaceId,
    getFolderIds: () => folder.id,
  })

  /**
   * Handle create workflow in folder
   */
  const handleCreateWorkflowInFolder = useCallback(async () => {
    const workflowId = await createWorkflow({
      workspaceId,
      folderId: folder.id,
    })

    if (workflowId) {
      router.push(`/workspace/${workspaceId}/w/${workflowId}`)
    }
  }, [createWorkflow, workspaceId, folder.id, router])

  // Folder expand hook
  const {
    isExpanded,
    handleToggleExpanded,
    handleKeyDown: handleExpandKeyDown,
  } = useFolderExpand({
    folderId: folder.id,
  })

  /**
   * Drag start handler - sets folder data for drag operation
   *
   * @param e - React drag event
   */
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      // Don't start drag if editing
      if (isEditing) {
        e.preventDefault()
        return
      }

      e.dataTransfer.setData('folder-id', folder.id)
      e.dataTransfer.effectAllowed = 'move'
    },
    [folder.id]
  )

  // Item drag hook
  const { isDragging, shouldPreventClickRef, handleDragStart, handleDragEnd } = useItemDrag({
    onDragStart,
  })

  // Context menu hook
  const {
    isOpen: isContextMenuOpen,
    position,
    menuRef,
    handleContextMenu,
    closeMenu,
  } = useContextMenu()

  // Rename hook
  const {
    isEditing,
    editValue,
    isRenaming,
    inputRef,
    setEditValue,
    handleStartEdit,
    handleKeyDown: handleRenameKeyDown,
    handleInputBlur,
  } = useItemRename({
    initialName: folder.name,
    onSave: async (newName) => {
      await updateFolderAPI(folder.id, { name: newName })
    },
    itemType: 'folder',
    itemId: folder.id,
  })

  /**
   * Handle double-click on folder name to enter rename mode
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleStartEdit()
    },
    [handleStartEdit]
  )

  /**
   * Handle click - toggles folder expansion
   *
   * @param e - React mouse event
   */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()

      if (shouldPreventClickRef.current || isEditing) {
        e.preventDefault()
        return
      }
      handleToggleExpanded()
    },
    [handleToggleExpanded, shouldPreventClickRef, isEditing]
  )

  /**
   * Combined keyboard handler for both expand and rename
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEditing) {
        handleRenameKeyDown(e)
      } else {
        handleExpandKeyDown(e)
      }
    },
    [isEditing, handleRenameKeyDown, handleExpandKeyDown]
  )

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        data-item-id={folder.id}
        aria-expanded={isExpanded}
        aria-label={`${folder.name} folder, ${isExpanded ? 'expanded' : 'collapsed'}`}
        className={clsx(
          'flex h-[25px] cursor-pointer items-center rounded-[8px] text-[14px]',
          isDragging ? 'opacity-50' : ''
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        {...hoverHandlers}
      >
        <ChevronRight
          className={clsx(
            'mr-[8px] h-[10px] w-[10px] flex-shrink-0 text-[var(--text-muted)] transition-all dark:text-[var(--text-muted)]',
            isExpanded ? 'rotate-90' : ''
          )}
          aria-hidden='true'
        />
        {isExpanded ? (
          <FolderOpen
            className='mr-[10px] h-[16px] w-[16px] flex-shrink-0 text-[var(--text-muted)] dark:text-[var(--text-muted)]'
            aria-hidden='true'
          />
        ) : (
          <Folder
            className='mr-[10px] h-[16px] w-[16px] flex-shrink-0 text-[var(--text-muted)] dark:text-[var(--text-muted)]'
            aria-hidden='true'
          />
        )}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleInputBlur}
            className={clsx(
              'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-[14px] text-[var(--text-tertiary)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-[var(--text-tertiary)]'
            )}
            maxLength={50}
            disabled={isRenaming}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
          />
        ) : (
          <span
            className='truncate font-medium text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'
            onDoubleClick={handleDoubleClick}
          >
            {folder.name}
          </span>
        )}
      </div>

      {/* Context Menu */}
      <ContextMenu
        isOpen={isContextMenuOpen}
        position={position}
        menuRef={menuRef}
        onClose={closeMenu}
        onRename={handleStartEdit}
        onCreate={handleCreateWorkflowInFolder}
        onDuplicate={handleDuplicateFolder}
        onDelete={() => setIsDeleteModalOpen(true)}
        showCreate={true}
      />

      {/* Delete Modal */}
      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteFolder}
        isDeleting={isDeleting}
        itemType='folder'
        itemName={folder.name}
      />
    </>
  )
}
