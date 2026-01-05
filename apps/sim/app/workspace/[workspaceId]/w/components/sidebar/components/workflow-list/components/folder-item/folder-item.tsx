'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  useContextMenu,
  useFolderExpand,
  useItemDrag,
  useItemRename,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { SIDEBAR_SCROLL_EVENT } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import {
  useCanDelete,
  useDeleteFolder,
  useDuplicateFolder,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { useCreateFolder, useUpdateFolder } from '@/hooks/queries/folders'
import { useCreateWorkflow } from '@/hooks/queries/workflows'
import type { FolderTreeNode } from '@/stores/folders/types'
import {
  generateCreativeWorkflowName,
  getNextWorkflowColor,
} from '@/stores/workflows/registry/utils'

const logger = createLogger('FolderItem')

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
  const updateFolderMutation = useUpdateFolder()
  const createWorkflowMutation = useCreateWorkflow()
  const createFolderMutation = useCreateFolder()
  const userPermissions = useUserPermissionsContext()

  const { canDeleteFolder } = useCanDelete({ workspaceId })
  const canDelete = useMemo(() => canDeleteFolder(folder.id), [canDeleteFolder, folder.id])

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

  // Folder expand hook - must be declared before callbacks that use expandFolder
  const {
    isExpanded,
    handleToggleExpanded,
    expandFolder,
    handleKeyDown: handleExpandKeyDown,
  } = useFolderExpand({
    folderId: folder.id,
  })

  /**
   * Handle create workflow in folder using React Query mutation.
   * Generates name and color upfront for optimistic UI updates.
   * The UI disables the trigger when isPending, so no guard needed here.
   */
  const handleCreateWorkflowInFolder = useCallback(async () => {
    try {
      // Generate name and color upfront for optimistic updates
      const name = generateCreativeWorkflowName()
      const color = getNextWorkflowColor()

      const result = await createWorkflowMutation.mutateAsync({
        workspaceId,
        folderId: folder.id,
        name,
        color,
      })

      if (result.id) {
        router.push(`/workspace/${workspaceId}/w/${result.id}`)
        // Expand the parent folder so the new workflow is visible
        expandFolder()
        // Scroll to the newly created workflow
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: result.id } })
        )
      }
    } catch (error) {
      // Error already handled by mutation's onError callback
      logger.error('Failed to create workflow in folder:', error)
    }
  }, [createWorkflowMutation, workspaceId, folder.id, router, expandFolder])

  /**
   * Handle create sub-folder using React Query mutation.
   * Creates a new folder inside the current folder.
   */
  const handleCreateFolderInFolder = useCallback(async () => {
    try {
      const result = await createFolderMutation.mutateAsync({
        workspaceId,
        name: 'New Folder',
        parentId: folder.id,
      })
      if (result.id) {
        // Expand the parent folder so the new folder is visible
        expandFolder()
        // Scroll to the newly created folder
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: result.id } })
        )
      }
    } catch (error) {
      logger.error('Failed to create folder:', error)
    }
  }, [createFolderMutation, workspaceId, folder.id, expandFolder])

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
      await updateFolderMutation.mutateAsync({
        workspaceId,
        id: folder.id,
        updates: { name: newName },
      })
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
          'group flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[8px] px-[6px] text-[14px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
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
            'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
            'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]',
            isExpanded && 'rotate-90'
          )}
          aria-hidden='true'
        />
        {isExpanded ? (
          <FolderOpen
            className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
            aria-hidden='true'
          />
        ) : (
          <Folder
            className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
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
              'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-[14px] text-[var(--text-tertiary)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
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
            className='truncate font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
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
        onCreateFolder={handleCreateFolderInFolder}
        onDuplicate={handleDuplicateFolder}
        onDelete={() => setIsDeleteModalOpen(true)}
        showCreate={true}
        showCreateFolder={true}
        disableRename={!userPermissions.canEdit}
        disableCreate={!userPermissions.canEdit || createWorkflowMutation.isPending}
        disableCreateFolder={!userPermissions.canEdit || createFolderMutation.isPending}
        disableDuplicate={!userPermissions.canEdit}
        disableDelete={!userPermissions.canEdit || !canDelete}
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
