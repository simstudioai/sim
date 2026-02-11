'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { ChevronRight, Folder, FolderOpen, MoreHorizontal } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  useContextMenu,
  useFolderExpand,
  useItemDrag,
  useItemRename,
  useSidebarDragContext,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { SIDEBAR_SCROLL_EVENT } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import {
  useCanDelete,
  useDeleteFolder,
  useDeleteSelection,
  useDuplicateFolder,
  useDuplicateSelection,
  useExportFolder,
  useExportSelection,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { useCreateFolder, useUpdateFolder } from '@/hooks/queries/folders'
import { useCreateWorkflow } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import type { FolderTreeNode } from '@/stores/folders/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'

const logger = createLogger('FolderItem')

interface FolderItemProps {
  folder: FolderTreeNode
  level: number
  dragDisabled?: boolean
  hoverHandlers?: {
    onDragEnter?: (e: React.DragEvent<HTMLElement>) => void
    onDragLeave?: (e: React.DragEvent<HTMLElement>) => void
  }
  onFolderClick?: (folderId: string, shiftKey: boolean, metaKey: boolean) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function FolderItem({
  folder,
  level,
  dragDisabled = false,
  hoverHandlers,
  onFolderClick,
  onDragStart: onDragStartProp,
  onDragEnd: onDragEndProp,
}: FolderItemProps) {
  const { isAnyDragActive } = useSidebarDragContext()
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const updateFolderMutation = useUpdateFolder()
  const createWorkflowMutation = useCreateWorkflow()
  const createFolderMutation = useCreateFolder()
  const userPermissions = useUserPermissionsContext()
  const selectedFolders = useFolderStore((state) => state.selectedFolders)
  const isSelected = selectedFolders.has(folder.id)

  const { canDeleteFolder, canDeleteWorkflows } = useCanDelete({ workspaceId })

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteItemType, setDeleteItemType] = useState<'folder' | 'mixed'>('folder')
  const [deleteItemNames, setDeleteItemNames] = useState<string | string[]>(folder.name)

  const capturedSelectionRef = useRef<{
    workflowIds: string[]
    folderIds: string[]
    isMixed: boolean
    names: string[]
  } | null>(null)

  const [canDeleteSelection, setCanDeleteSelection] = useState(true)

  const { isDeleting: isDeletingThisFolder, handleDeleteFolder: handleDeleteThisFolder } =
    useDeleteFolder({
      workspaceId,
      folderIds: folder.id,
      onSuccess: () => setIsDeleteModalOpen(false),
    })

  const { isDeleting: isDeletingSelection, handleDeleteSelection } = useDeleteSelection({
    workspaceId,
    workflowIds: capturedSelectionRef.current?.workflowIds || [],
    folderIds: capturedSelectionRef.current?.folderIds || [],
    isActiveWorkflow: (id) => id === params.workflowId,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  const isDeleting = isDeletingThisFolder || isDeletingSelection

  const { handleDuplicateFolder: handleDuplicateThisFolder } = useDuplicateFolder({
    workspaceId,
    folderIds: folder.id,
  })

  const { isDuplicating: isDuplicatingSelection, handleDuplicateSelection } = useDuplicateSelection(
    {
      workspaceId,
    }
  )

  const {
    isExporting: isExportingThisFolder,
    hasWorkflows,
    handleExportFolder: handleExportThisFolder,
  } = useExportFolder({
    folderId: folder.id,
  })

  const { isExporting: isExportingSelection, handleExportSelection } = useExportSelection()

  const isExporting = isExportingThisFolder || isExportingSelection

  const {
    isExpanded,
    handleToggleExpanded,
    expandFolder,
    handleKeyDown: handleExpandKeyDown,
  } = useFolderExpand({
    folderId: folder.id,
  })

  const isEditingRef = useRef(false)

  const handleCreateWorkflowInFolder = useCallback(async () => {
    try {
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
        expandFolder()
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: result.id } })
        )
      }
    } catch (error) {
      logger.error('Failed to create workflow in folder:', error)
    }
  }, [createWorkflowMutation, workspaceId, folder.id, router, expandFolder])

  const handleCreateFolderInFolder = useCallback(async () => {
    try {
      const result = await createFolderMutation.mutateAsync({
        workspaceId,
        name: 'New Folder',
        parentId: folder.id,
      })
      if (result.id) {
        expandFolder()
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_SCROLL_EVENT, { detail: { itemId: result.id } })
        )
      }
    } catch (error) {
      logger.error('Failed to create folder:', error)
    }
  }, [createFolderMutation, workspaceId, folder.id, expandFolder])

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      if (isEditingRef.current) {
        e.preventDefault()
        return
      }

      const { selectedWorkflows, selectedFolders } = useFolderStore.getState()
      const isCurrentlySelected = selectedFolders.has(folder.id)

      const selection = isCurrentlySelected
        ? {
            workflowIds: Array.from(selectedWorkflows),
            folderIds: Array.from(selectedFolders),
          }
        : {
            workflowIds: [],
            folderIds: [folder.id],
          }

      e.dataTransfer.setData('sidebar-selection', JSON.stringify(selection))
      e.dataTransfer.effectAllowed = 'move'
      onDragStartProp?.()
    },
    [folder.id, onDragStartProp]
  )

  const {
    isDragging,
    shouldPreventClickRef,
    handleDragStart,
    handleDragEnd: handleDragEndBase,
  } = useItemDrag({
    onDragStart,
  })

  const handleDragEnd = useCallback(() => {
    handleDragEndBase()
    onDragEndProp?.()
  }, [handleDragEndBase, onDragEndProp])

  const {
    isOpen: isContextMenuOpen,
    position,
    menuRef,
    handleContextMenu: handleContextMenuBase,
    closeMenu,
    preventDismiss,
  } = useContextMenu()

  const captureSelectionState = useCallback(() => {
    const store = useFolderStore.getState()
    const isFolderSelected = store.selectedFolders.has(folder.id)

    if (!isFolderSelected) {
      // Replace selection with just this folder (Finder/Explorer pattern)
      store.clearAllSelection()
      store.selectFolder(folder.id)
    }

    const finalFolderSelection = useFolderStore.getState().selectedFolders
    const finalWorkflowSelection = useFolderStore.getState().selectedWorkflows

    const folderIds = Array.from(finalFolderSelection)
    const workflowIds = Array.from(finalWorkflowSelection)
    const isMixed = folderIds.length > 0 && workflowIds.length > 0

    const { folders } = useFolderStore.getState()
    const { workflows } = useWorkflowRegistry.getState()

    const names: string[] = []
    for (const id of folderIds) {
      const f = folders[id]
      if (f) names.push(f.name)
    }
    for (const id of workflowIds) {
      const w = workflows[id]
      if (w) names.push(w.name)
    }

    capturedSelectionRef.current = {
      workflowIds,
      folderIds,
      isMixed,
      names,
    }

    const canDeleteAllFolders = folderIds.every((id) => canDeleteFolder(id))
    const canDeleteAllWorkflows = workflowIds.length === 0 || canDeleteWorkflows(workflowIds)
    setCanDeleteSelection(canDeleteAllFolders && canDeleteAllWorkflows)
  }, [folder.id, canDeleteFolder, canDeleteWorkflows])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      captureSelectionState()
      handleContextMenuBase(e)
    },
    [captureSelectionState, handleContextMenuBase]
  )

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

  isEditingRef.current = isEditing

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleStartEdit()
    },
    [handleStartEdit]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()

      if (shouldPreventClickRef.current || isEditing) {
        e.preventDefault()
        return
      }

      const isModifierClick = e.shiftKey || e.metaKey || e.ctrlKey

      if (isModifierClick && onFolderClick) {
        e.preventDefault()
        onFolderClick(folder.id, e.shiftKey, e.metaKey || e.ctrlKey)
        return
      }

      useFolderStore.getState().clearFolderSelection()
      handleToggleExpanded()
    },
    [handleToggleExpanded, shouldPreventClickRef, isEditing, onFolderClick, folder.id]
  )

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

  const handleMorePointerDown = useCallback(() => {
    if (isContextMenuOpen) {
      preventDismiss()
    }
  }, [isContextMenuOpen, preventDismiss])

  const handleMoreClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()

      if (isContextMenuOpen) {
        closeMenu()
        return
      }

      captureSelectionState()
      const rect = e.currentTarget.getBoundingClientRect()
      handleContextMenuBase({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: rect.right,
        clientY: rect.top,
      } as React.MouseEvent)
    },
    [isContextMenuOpen, closeMenu, captureSelectionState, handleContextMenuBase]
  )

  const handleOpenDeleteModal = useCallback(() => {
    if (!capturedSelectionRef.current) return

    const { isMixed, names, folderIds } = capturedSelectionRef.current

    if (isMixed) {
      setDeleteItemType('mixed')
      setDeleteItemNames(names)
    } else if (folderIds.length > 1) {
      setDeleteItemType('folder')
      setDeleteItemNames(names)
    } else {
      setDeleteItemType('folder')
      setDeleteItemNames(folder.name)
    }

    setIsDeleteModalOpen(true)
  }, [folder.name])

  const handleConfirmDelete = useCallback(async () => {
    if (!capturedSelectionRef.current) return

    const { isMixed, folderIds } = capturedSelectionRef.current

    if (isMixed || folderIds.length > 1) {
      await handleDeleteSelection()
    } else {
      await handleDeleteThisFolder()
    }
  }, [handleDeleteSelection, handleDeleteThisFolder])

  const handleExport = useCallback(async () => {
    if (!capturedSelectionRef.current) return

    const { isMixed, workflowIds, folderIds } = capturedSelectionRef.current

    if (isMixed || folderIds.length > 1) {
      await handleExportSelection(workflowIds, folderIds)
    } else {
      await handleExportThisFolder()
    }
  }, [handleExportSelection, handleExportThisFolder])

  const handleDuplicate = useCallback(async () => {
    if (!capturedSelectionRef.current) return

    const { isMixed, workflowIds, folderIds } = capturedSelectionRef.current

    if (isMixed || folderIds.length > 1) {
      await handleDuplicateSelection(workflowIds, folderIds)
    } else {
      await handleDuplicateThisFolder()
    }
  }, [handleDuplicateSelection, handleDuplicateThisFolder])

  const isMixedSelection = useMemo(() => {
    return capturedSelectionRef.current?.isMixed ?? false
  }, [isContextMenuOpen])

  const hasExportableContent = useMemo(() => {
    if (!capturedSelectionRef.current) return hasWorkflows
    const { workflowIds } = capturedSelectionRef.current
    return workflowIds.length > 0 || hasWorkflows
  }, [isContextMenuOpen, hasWorkflows])

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        data-item-id={folder.id}
        aria-expanded={isExpanded}
        aria-label={`${folder.name} folder, ${isExpanded ? 'expanded' : 'collapsed'}`}
        className={clsx(
          'group flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[8px] px-[6px] text-[14px]',
          !isAnyDragActive && 'hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
          isSelected ? 'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]' : '',
          (isDragging || (isAnyDragActive && isSelected)) && 'opacity-50'
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        draggable={!isEditing && !dragDisabled}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        {...hoverHandlers}
      >
        <ChevronRight
          className={clsx(
            'h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100',
            !isAnyDragActive && 'group-hover:text-[var(--text-primary)]',
            isExpanded && 'rotate-90'
          )}
          aria-hidden='true'
        />
        {isExpanded ? (
          <FolderOpen
            className={clsx(
              'h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]',
              !isAnyDragActive && 'group-hover:text-[var(--text-primary)]'
            )}
            aria-hidden='true'
          />
        ) : (
          <Folder
            className={clsx(
              'h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]',
              !isAnyDragActive && 'group-hover:text-[var(--text-primary)]'
            )}
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
          <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
            <span
              className={clsx(
                'min-w-0 flex-1 truncate font-medium text-[var(--text-tertiary)]',
                !isAnyDragActive && 'group-hover:text-[var(--text-primary)]'
              )}
              onDoubleClick={handleDoubleClick}
            >
              {folder.name}
            </span>
            <button
              type='button'
              aria-label='Folder options'
              onPointerDown={handleMorePointerDown}
              onClick={handleMoreClick}
              className={clsx(
                'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-opacity hover:bg-[var(--surface-7)]',
                !isAnyDragActive && 'group-hover:opacity-100'
              )}
            >
              <MoreHorizontal className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            </button>
          </div>
        )}
      </div>

      <ContextMenu
        isOpen={isContextMenuOpen}
        position={position}
        menuRef={menuRef}
        onClose={closeMenu}
        onRename={handleStartEdit}
        onCreate={handleCreateWorkflowInFolder}
        onCreateFolder={handleCreateFolderInFolder}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onDelete={handleOpenDeleteModal}
        showCreate={!isMixedSelection}
        showCreateFolder={!isMixedSelection}
        showRename={!isMixedSelection && selectedFolders.size <= 1}
        showDuplicate={true}
        showExport={true}
        disableRename={!userPermissions.canEdit}
        disableCreate={!userPermissions.canEdit || createWorkflowMutation.isPending}
        disableCreateFolder={!userPermissions.canEdit || createFolderMutation.isPending}
        disableDuplicate={
          !userPermissions.canEdit || isDuplicatingSelection || !hasExportableContent
        }
        disableExport={!userPermissions.canEdit || isExporting || !hasExportableContent}
        disableDelete={!userPermissions.canEdit || !canDeleteSelection}
      />

      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        itemType={deleteItemType}
        itemName={deleteItemNames}
      />
    </>
  )
}
