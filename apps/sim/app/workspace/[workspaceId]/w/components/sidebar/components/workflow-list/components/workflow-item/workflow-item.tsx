'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import { Avatars } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/workflow-item/avatars/avatars'
import {
  useContextMenu,
  useItemDrag,
  useItemRename,
  useSidebarDragContext,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useCanDelete,
  useDeleteSelection,
  useDeleteWorkflow,
  useDuplicateSelection,
  useDuplicateWorkflow,
  useExportSelection,
  useExportWorkflow,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  level: number
  dragDisabled?: boolean
  onWorkflowClick: (workflowId: string, shiftKey: boolean, metaKey: boolean) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

/**
 * WorkflowItem component displaying a single workflow with drag and selection support.
 * Uses the item drag hook for unified drag behavior.
 *
 * @param props - Component props
 * @returns Workflow item with drag and selection support
 */
export function WorkflowItem({
  workflow,
  active,
  level,
  dragDisabled = false,
  onWorkflowClick,
  onDragStart: onDragStartProp,
  onDragEnd: onDragEndProp,
}: WorkflowItemProps) {
  const { isAnyDragActive } = useSidebarDragContext()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const selectedWorkflows = useFolderStore((state) => state.selectedWorkflows)
  const updateWorkflow = useWorkflowRegistry((state) => state.updateWorkflow)
  const userPermissions = useUserPermissionsContext()
  const isSelected = selectedWorkflows.has(workflow.id)

  const { canDeleteWorkflows, canDeleteFolder } = useCanDelete({ workspaceId })

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteItemType, setDeleteItemType] = useState<'workflow' | 'mixed'>('workflow')
  const [deleteModalNames, setDeleteModalNames] = useState<string | string[]>('')
  const [canDeleteSelection, setCanDeleteSelection] = useState(true)

  const capturedSelectionRef = useRef<{
    workflowIds: string[]
    folderIds: string[]
    isMixed: boolean
    names: string[]
  } | null>(null)

  /**
   * Handle opening the delete modal - uses pre-captured selection state
   */
  const handleOpenDeleteModal = useCallback(() => {
    if (!capturedSelectionRef.current) return

    const { isMixed, names } = capturedSelectionRef.current

    if (isMixed) {
      setDeleteItemType('mixed')
    } else {
      setDeleteItemType('workflow')
    }

    setDeleteModalNames(names.length > 1 ? names : names[0] || '')
    setIsDeleteModalOpen(true)
  }, [])

  const { isDeleting: isDeletingWorkflows, handleDeleteWorkflow: handleDeleteWorkflows } =
    useDeleteWorkflow({
      workspaceId,
      workflowIds: capturedSelectionRef.current?.workflowIds || [],
      isActive: (workflowIds) => workflowIds.includes(params.workflowId as string),
      onSuccess: () => setIsDeleteModalOpen(false),
    })

  const { isDeleting: isDeletingSelection, handleDeleteSelection } = useDeleteSelection({
    workspaceId,
    workflowIds: capturedSelectionRef.current?.workflowIds || [],
    folderIds: capturedSelectionRef.current?.folderIds || [],
    isActiveWorkflow: (id) => id === params.workflowId,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  const isDeleting = isDeletingWorkflows || isDeletingSelection

  const handleConfirmDelete = useCallback(async () => {
    if (!capturedSelectionRef.current) return

    const { isMixed } = capturedSelectionRef.current

    if (isMixed) {
      await handleDeleteSelection()
    } else {
      await handleDeleteWorkflows()
    }
  }, [handleDeleteSelection, handleDeleteWorkflows])

  const { handleDuplicateWorkflow: duplicateWorkflows } = useDuplicateWorkflow({ workspaceId })
  const { isDuplicating: isDuplicatingSelection, handleDuplicateSelection } = useDuplicateSelection(
    { workspaceId }
  )

  const { handleExportWorkflow: handleExportWorkflows } = useExportWorkflow()
  const { handleExportSelection } = useExportSelection()

  const handleDuplicate = useCallback(() => {
    if (!capturedSelectionRef.current) return

    const { isMixed, workflowIds, folderIds } = capturedSelectionRef.current

    if (isMixed) {
      handleDuplicateSelection(workflowIds, folderIds)
    } else {
      if (workflowIds.length === 0) return
      duplicateWorkflows(workflowIds)
    }
  }, [duplicateWorkflows, handleDuplicateSelection])

  const handleExport = useCallback(() => {
    if (!capturedSelectionRef.current) return

    const { isMixed, workflowIds, folderIds } = capturedSelectionRef.current

    if (isMixed) {
      handleExportSelection(workflowIds, folderIds)
    } else {
      if (workflowIds.length === 0) return
      handleExportWorkflows(workflowIds)
    }
  }, [handleExportWorkflows, handleExportSelection])

  const handleOpenInNewTab = useCallback(() => {
    window.open(`/workspace/${workspaceId}/w/${workflow.id}`, '_blank')
  }, [workspaceId, workflow.id])

  const handleColorChange = useCallback(
    (color: string) => {
      updateWorkflow(workflow.id, { color })
    },
    [workflow.id, updateWorkflow]
  )

  const isEditingRef = useRef(false)

  const {
    isOpen: isContextMenuOpen,
    position,
    menuRef,
    handleContextMenu: handleContextMenuBase,
    closeMenu,
    preventDismiss,
  } = useContextMenu()

  const isMixedSelection = useMemo(() => {
    return capturedSelectionRef.current?.isMixed ?? false
  }, [isContextMenuOpen])

  const captureSelectionState = useCallback(() => {
    const store = useFolderStore.getState()
    const isCurrentlySelected = store.selectedWorkflows.has(workflow.id)

    if (!isCurrentlySelected) {
      // Replace selection with just this item (Finder/Explorer pattern)
      // This clears both workflow and folder selections
      store.clearAllSelection()
      store.selectWorkflow(workflow.id)
    }

    const finalWorkflowSelection = useFolderStore.getState().selectedWorkflows
    const finalFolderSelection = useFolderStore.getState().selectedFolders

    const workflowIds = Array.from(finalWorkflowSelection)
    const folderIds = Array.from(finalFolderSelection)
    const isMixed = workflowIds.length > 0 && folderIds.length > 0

    const { workflows } = useWorkflowRegistry.getState()
    const { folders } = useFolderStore.getState()

    const names: string[] = []
    for (const id of workflowIds) {
      const w = workflows[id]
      if (w) names.push(w.name)
    }
    for (const id of folderIds) {
      const f = folders[id]
      if (f) names.push(f.name)
    }

    capturedSelectionRef.current = {
      workflowIds,
      folderIds,
      isMixed,
      names,
    }

    const canDeleteAllWorkflows = canDeleteWorkflows(workflowIds)
    const canDeleteAllFolders =
      folderIds.length === 0 || folderIds.every((id) => canDeleteFolder(id))
    setCanDeleteSelection(canDeleteAllWorkflows && canDeleteAllFolders)
  }, [workflow.id, canDeleteWorkflows, canDeleteFolder])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      captureSelectionState()
      handleContextMenuBase(e)
    },
    [captureSelectionState, handleContextMenuBase]
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

  const {
    isEditing,
    editValue,
    isRenaming,
    inputRef,
    setEditValue,
    handleStartEdit,
    handleKeyDown,
    handleInputBlur,
  } = useItemRename({
    initialName: workflow.name,
    onSave: async (newName) => {
      await updateWorkflow(workflow.id, { name: newName })
    },
    itemType: 'workflow',
    itemId: workflow.id,
  })

  isEditingRef.current = isEditing

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      if (isEditingRef.current) {
        e.preventDefault()
        return
      }

      const { selectedWorkflows, selectedFolders } = useFolderStore.getState()
      const isCurrentlySelected = selectedWorkflows.has(workflow.id)

      const selection = isCurrentlySelected
        ? {
            workflowIds: Array.from(selectedWorkflows),
            folderIds: Array.from(selectedFolders),
          }
        : {
            workflowIds: [workflow.id],
            folderIds: [],
          }

      e.dataTransfer.setData('sidebar-selection', JSON.stringify(selection))
      e.dataTransfer.effectAllowed = 'move'
      onDragStartProp?.()
    },
    [workflow.id, onDragStartProp]
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

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleStartEdit()
    },
    [handleStartEdit]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.stopPropagation()

      if (shouldPreventClickRef.current || isEditing) {
        e.preventDefault()
        return
      }

      const isModifierClick = e.shiftKey || e.metaKey || e.ctrlKey

      if (isModifierClick) {
        e.preventDefault()
      }

      onWorkflowClick(workflow.id, e.shiftKey, e.metaKey || e.ctrlKey)
    },
    [shouldPreventClickRef, workflow.id, onWorkflowClick, isEditing]
  )

  return (
    <>
      <Link
        href={`/workspace/${workspaceId}/w/${workflow.id}`}
        data-item-id={workflow.id}
        className={clsx(
          'group flex h-[26px] items-center gap-[8px] rounded-[8px] px-[6px] text-[14px]',
          active && 'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]',
          !active &&
            !isAnyDragActive &&
            'hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
          isSelected &&
            selectedWorkflows.size > 1 &&
            !active &&
            'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]',
          (isDragging || (isAnyDragActive && isSelected)) && 'opacity-50'
        )}
        draggable={!isEditing && !dragDisabled}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div
          className='h-[14px] w-[14px] flex-shrink-0 rounded-[4px]'
          style={{ backgroundColor: workflow.color }}
        />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-[8px]'>
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleInputBlur}
                className={clsx(
                  'w-full min-w-0 border-0 bg-transparent p-0 font-medium text-[14px] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                  active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                  !active && !isAnyDragActive && 'group-hover:text-[var(--text-primary)]'
                )}
                maxLength={100}
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
              <div
                className={clsx(
                  'min-w-0 truncate font-medium',
                  active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                  !active && !isAnyDragActive && 'group-hover:text-[var(--text-primary)]'
                )}
                onDoubleClick={handleDoubleClick}
              >
                {workflow.name}
              </div>
            )}
            {!isEditing && <Avatars workflowId={workflow.id} />}
          </div>
        </div>
        {!isEditing && (
          <>
            <button
              type='button'
              aria-label='Workflow options'
              onPointerDown={handleMorePointerDown}
              onClick={handleMoreClick}
              className={clsx(
                'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-opacity hover:bg-[var(--surface-7)]',
                !isAnyDragActive && 'group-hover:opacity-100'
              )}
            >
              <MoreHorizontal className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            </button>
          </>
        )}
      </Link>

      <ContextMenu
        isOpen={isContextMenuOpen}
        position={position}
        menuRef={menuRef}
        onClose={closeMenu}
        onOpenInNewTab={handleOpenInNewTab}
        onRename={handleStartEdit}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onDelete={handleOpenDeleteModal}
        onColorChange={handleColorChange}
        currentColor={workflow.color}
        showOpenInNewTab={!isMixedSelection && selectedWorkflows.size <= 1}
        showRename={!isMixedSelection && selectedWorkflows.size <= 1}
        showDuplicate={true}
        showExport={true}
        showColorChange={!isMixedSelection && selectedWorkflows.size <= 1}
        disableRename={!userPermissions.canEdit}
        disableDuplicate={!userPermissions.canEdit || isDuplicatingSelection}
        disableExport={!userPermissions.canEdit}
        disableColorChange={!userPermissions.canEdit}
        disableDelete={!userPermissions.canEdit || !canDeleteSelection}
      />

      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        itemType={deleteItemType}
        itemName={deleteModalNames}
      />
    </>
  )
}
