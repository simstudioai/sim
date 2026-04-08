'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { SIM_RESOURCES_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getWorkflowLockToggleIds } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
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
  buildDragResources,
  createSidebarDragGhost,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import {
  useCanDelete,
  useDeleteSelection,
  useDeleteWorkflow,
  useDuplicateSelection,
  useDuplicateWorkflow,
  useExportSelection,
  useExportWorkflow,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { useUpdateWorkflow } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  level: number
  dragDisabled?: boolean
  onWorkflowClick: (workflowId: string, shiftKey: boolean) => void
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
  const updateWorkflowMutation = useUpdateWorkflow()
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
      updateWorkflowMutation.mutate({ workspaceId, workflowId: workflow.id, metadata: { color } })
    },
    [workflow.id, workspaceId]
  )

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const isActiveWorkflow = workflow.id === activeWorkflowId

  const isWorkflowLocked = useWorkflowStore(
    useCallback(
      (state) => {
        if (!isActiveWorkflow) return false
        const blockValues = Object.values(state.blocks)
        if (blockValues.length === 0) return false
        return blockValues.every((block) => block.locked)
      },
      [isActiveWorkflow]
    )
  )

  const handleToggleLock = useCallback(() => {
    if (!isActiveWorkflow) return
    const blocks = useWorkflowStore.getState().blocks
    const blockIds = getWorkflowLockToggleIds(blocks, !isWorkflowLocked)
    if (blockIds.length === 0) return
    window.dispatchEvent(new CustomEvent('toggle-workflow-lock', { detail: { blockIds } }))
  }, [isActiveWorkflow, isWorkflowLocked])

  const isEditingRef = useRef(false)
  const dragGhostRef = useRef<HTMLElement | null>(null)

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

    const workflows = getWorkflows(workspaceId)
    const folderMap = getFolderMap(workspaceId)

    const names: string[] = []
    for (const id of workflowIds) {
      const w = workflows.find((wf) => wf.id === id)
      if (w) names.push(w.name)
    }
    for (const id of folderIds) {
      const f = folderMap[id]
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
      await updateWorkflowMutation.mutateAsync({
        workspaceId,
        workflowId: workflow.id,
        metadata: { name: newName },
      })
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
      e.dataTransfer.effectAllowed = 'copyMove'

      const resources = buildDragResources(selection, workspaceId)
      if (resources.length > 0) {
        e.dataTransfer.setData(SIM_RESOURCES_DRAG_TYPE, JSON.stringify(resources))
      }

      const total = selection.workflowIds.length + selection.folderIds.length
      const ghostLabel = total > 1 ? `${workflow.name} +${total - 1} more` : workflow.name
      const icon = total === 1 ? { kind: 'workflow' as const, color: workflow.color } : undefined
      const ghost = createSidebarDragGhost(ghostLabel, icon)
      // Force reflow so the browser can capture the rendered element
      void ghost.offsetHeight
      e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
      dragGhostRef.current = ghost

      onDragStartProp?.()
    },
    [workflow.id, workflow.name, workflow.color, workspaceId, onDragStartProp]
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
    if (dragGhostRef.current) {
      dragGhostRef.current.remove()
      dragGhostRef.current = null
    }
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

      if (e.metaKey || e.ctrlKey) {
        return
      }

      if (e.shiftKey) {
        e.preventDefault()
      }

      onWorkflowClick(workflow.id, e.shiftKey)
    },
    [shouldPreventClickRef, workflow.id, onWorkflowClick, isEditing]
  )

  return (
    <>
      <Link
        href={`/workspace/${workspaceId}/w/${workflow.id}`}
        data-item-id={workflow.id}
        className={clsx(
          'group mx-0.5 flex h-[30px] items-center gap-2 rounded-lg px-2 text-sm',
          (active || isContextMenuOpen || (isSelected && selectedWorkflows.size > 1)) &&
            'bg-[var(--surface-active)]',
          !active &&
            !isContextMenuOpen &&
            !(isSelected && selectedWorkflows.size > 1) &&
            !isAnyDragActive &&
            'hover-hover:bg-[var(--surface-hover)]',
          (isDragging || (isAnyDragActive && isSelected)) && 'opacity-50'
        )}
        draggable={!isEditing && !dragDisabled}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div
          className='h-[16px] w-[16px] flex-shrink-0 rounded-sm border-[2.5px]'
          style={{
            backgroundColor: workflow.color,
            borderColor: workflowBorderColor(workflow.color),
            backgroundClip: 'padding-box',
          }}
        />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleInputBlur}
                className='w-full min-w-0 border-0 bg-transparent p-0 font-base text-[var(--text-body)] text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
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
                className='min-w-0 truncate font-base text-[var(--text-body)]'
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
                'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity',
                !isAnyDragActive && 'group-hover:opacity-100',
                isContextMenuOpen && 'opacity-100'
              )}
            >
              <MoreHorizontal className='h-[16px] w-[16px] text-[var(--text-icon)]' />
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
        onToggleLock={handleToggleLock}
        showLock={isActiveWorkflow && !isMixedSelection && selectedWorkflows.size <= 1}
        disableLock={!userPermissions.canAdmin}
        isLocked={isWorkflowLocked}
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
