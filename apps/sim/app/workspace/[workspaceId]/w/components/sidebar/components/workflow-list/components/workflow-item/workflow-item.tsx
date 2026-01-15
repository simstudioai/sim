'use client'

import { useCallback, useRef, useState } from 'react'
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
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useCanDelete,
  useDeleteWorkflow,
  useDuplicateWorkflow,
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
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { selectedWorkflows } = useFolderStore()
  const { updateWorkflow, workflows } = useWorkflowRegistry()
  const userPermissions = useUserPermissionsContext()
  const isSelected = selectedWorkflows.has(workflow.id)

  const { canDeleteWorkflows } = useCanDelete({ workspaceId })

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [workflowIdsToDelete, setWorkflowIdsToDelete] = useState<string[]>([])
  const [deleteModalNames, setDeleteModalNames] = useState<string | string[]>('')
  const [canDeleteCaptured, setCanDeleteCaptured] = useState(true)

  const [hasAvatars, setHasAvatars] = useState(false)

  const capturedSelectionRef = useRef<{
    workflowIds: string[]
    workflowNames: string | string[]
  } | null>(null)

  /**
   * Handle opening the delete modal - uses pre-captured selection state
   */
  const handleOpenDeleteModal = useCallback(() => {
    if (capturedSelectionRef.current) {
      setWorkflowIdsToDelete(capturedSelectionRef.current.workflowIds)
      setDeleteModalNames(capturedSelectionRef.current.workflowNames)
      setIsDeleteModalOpen(true)
    }
  }, [])

  const { isDeleting, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    workflowIds: workflowIdsToDelete,
    isActive: (workflowIds) => workflowIds.includes(params.workflowId as string),
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  const { handleDuplicateWorkflow: duplicateWorkflow } = useDuplicateWorkflow({ workspaceId })

  const { handleExportWorkflow: exportWorkflow } = useExportWorkflow()
  const handleDuplicateWorkflow = useCallback(() => {
    const workflowIds = capturedSelectionRef.current?.workflowIds || []
    if (workflowIds.length === 0) return
    duplicateWorkflow(workflowIds)
  }, [duplicateWorkflow])

  const handleExportWorkflow = useCallback(() => {
    const workflowIds = capturedSelectionRef.current?.workflowIds || []
    if (workflowIds.length === 0) return
    exportWorkflow(workflowIds)
  }, [exportWorkflow])

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

  /**
   * Captures selection state for context menu operations
   */
  const captureSelectionState = useCallback(() => {
    const { selectedWorkflows: currentSelection, selectOnly } = useFolderStore.getState()
    const isCurrentlySelected = currentSelection.has(workflow.id)

    if (!isCurrentlySelected) {
      selectOnly(workflow.id)
    }

    const finalSelection = useFolderStore.getState().selectedWorkflows
    const finalIsSelected = finalSelection.has(workflow.id)

    const workflowIds =
      finalIsSelected && finalSelection.size > 1 ? Array.from(finalSelection) : [workflow.id]

    const workflowNames = workflowIds
      .map((id) => workflows[id]?.name)
      .filter((name): name is string => !!name)

    capturedSelectionRef.current = {
      workflowIds,
      workflowNames: workflowNames.length > 1 ? workflowNames : workflowNames[0],
    }

    setCanDeleteCaptured(canDeleteWorkflows(workflowIds))
  }, [workflow.id, workflows, canDeleteWorkflows])

  /**
   * Handle right-click - ensure proper selection behavior and capture selection state
   * If right-clicking on an unselected workflow, select only that workflow
   * If right-clicking on a selected workflow with multiple selections, keep all selections
   */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      captureSelectionState()
      handleContextMenuBase(e)
    },
    [captureSelectionState, handleContextMenuBase]
  )

  /**
   * Handle more button pointerdown - prevents click-outside dismissal when toggling
   */
  const handleMorePointerDown = useCallback(() => {
    if (isContextMenuOpen) {
      preventDismiss()
    }
  }, [isContextMenuOpen, preventDismiss])

  /**
   * Handle more button click - toggles context menu at button position
   */
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

      const currentSelection = useFolderStore.getState().selectedWorkflows
      const isCurrentlySelected = currentSelection.has(workflow.id)
      const workflowIds =
        isCurrentlySelected && currentSelection.size > 1
          ? Array.from(currentSelection)
          : [workflow.id]

      e.dataTransfer.setData('workflow-ids', JSON.stringify(workflowIds))
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

  /**
   * Handle double-click on workflow name to enter rename mode
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
   * Handle click - manages workflow selection with shift-key and cmd/ctrl-key support
   *
   * @param e - React mouse event
   */
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
          active
            ? 'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]'
            : 'hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
          isSelected && selectedWorkflows.size > 1 && !active
            ? 'bg-[var(--surface-6)] dark:bg-[var(--surface-5)]'
            : '',
          isDragging ? 'opacity-50' : ''
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
        <div className={clsx('min-w-0 flex-1', hasAvatars && 'pr-[8px]')}>
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className={clsx(
                'w-full border-0 bg-transparent p-0 font-medium text-[14px] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                active
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
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
                'truncate font-medium',
                active
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
              )}
              onDoubleClick={handleDoubleClick}
            >
              {workflow.name}
            </div>
          )}
        </div>
        {!isEditing && (
          <>
            <Avatars workflowId={workflow.id} onPresenceChange={setHasAvatars} />
            <button
              type='button'
              onPointerDown={handleMorePointerDown}
              onClick={handleMoreClick}
              className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-opacity hover:bg-[var(--surface-7)] group-hover:opacity-100'
            >
              <MoreHorizontal className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            </button>
          </>
        )}
      </Link>

      {/* Context Menu */}
      <ContextMenu
        isOpen={isContextMenuOpen}
        position={position}
        menuRef={menuRef}
        onClose={closeMenu}
        onOpenInNewTab={handleOpenInNewTab}
        onRename={handleStartEdit}
        onDuplicate={handleDuplicateWorkflow}
        onExport={handleExportWorkflow}
        onDelete={handleOpenDeleteModal}
        onColorChange={handleColorChange}
        currentColor={workflow.color}
        showOpenInNewTab={selectedWorkflows.size <= 1}
        showRename={selectedWorkflows.size <= 1}
        showDuplicate={true}
        showExport={true}
        showColorChange={selectedWorkflows.size <= 1}
        disableRename={!userPermissions.canEdit}
        disableDuplicate={!userPermissions.canEdit}
        disableExport={!userPermissions.canEdit}
        disableColorChange={!userPermissions.canEdit}
        disableDelete={!userPermissions.canEdit || !canDeleteCaptured}
      />

      {/* Delete Confirmation Modal */}
      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteWorkflow}
        isDeleting={isDeleting}
        itemType='workflow'
        itemName={deleteModalNames}
      />
    </>
  )
}
