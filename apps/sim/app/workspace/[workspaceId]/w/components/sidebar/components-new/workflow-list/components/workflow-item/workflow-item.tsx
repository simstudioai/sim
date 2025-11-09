'use client'

import { useCallback, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useDeleteWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useContextMenu, useItemDrag, useItemRename } from '../../../../hooks'
import { ContextMenu } from '../context-menu/context-menu'
import { DeleteModal } from '../delete-modal/delete-modal'

const logger = createLogger('WorkflowItem')

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  level: number
  onWorkflowClick: (workflowId: string, shiftKey: boolean, metaKey: boolean) => void
}

/**
 * WorkflowItem component displaying a single workflow with drag and selection support.
 * Uses the item drag hook for unified drag behavior.
 *
 * @param props - Component props
 * @returns Workflow item with drag and selection support
 */
export function WorkflowItem({ workflow, active, level, onWorkflowClick }: WorkflowItemProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { selectedWorkflows } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()
  const isSelected = selectedWorkflows.has(workflow.id)

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Delete workflow hook
  const { isDeleting, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    workflowId: workflow.id,
    isActive: active,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  /**
   * Drag start handler - handles workflow dragging with multi-selection support
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

      const workflowIds =
        isSelected && selectedWorkflows.size > 1 ? Array.from(selectedWorkflows) : [workflow.id]

      e.dataTransfer.setData('workflow-ids', JSON.stringify(workflowIds))
      e.dataTransfer.effectAllowed = 'move'
    },
    [isSelected, selectedWorkflows, workflow.id]
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

      // Prevent default link behavior when using modifier keys
      if (isModifierClick) {
        e.preventDefault()
      }

      // Use metaKey (Cmd on Mac) or ctrlKey (Ctrl on Windows/Linux)
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
          'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5.5px] text-[14px]',
          active ? 'bg-[#2C2C2C] dark:bg-[#2C2C2C]' : 'hover:bg-[#2C2C2C] dark:hover:bg-[#2C2C2C]',
          isSelected && selectedWorkflows.size > 1 && !active
            ? 'bg-[#2C2C2C] dark:bg-[#2C2C2C]'
            : '',
          isDragging ? 'opacity-50' : ''
        )}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div
          className='h-[14px] w-[14px] flex-shrink-0 rounded-[4px]'
          style={{ backgroundColor: workflow.color }}
        />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleInputBlur}
            className={clsx(
              'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-[14px] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
              active
                ? 'text-[#E6E6E6] dark:text-[#E6E6E6]'
                : 'text-[#AEAEAE] group-hover:text-[#E6E6E6] dark:text-[#AEAEAE] dark:group-hover:text-[#E6E6E6]'
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
          <span
            className={clsx(
              'truncate font-medium',
              active
                ? 'text-[#E6E6E6] dark:text-[#E6E6E6]'
                : 'text-[#AEAEAE] group-hover:text-[#E6E6E6] dark:text-[#AEAEAE] dark:group-hover:text-[#E6E6E6]'
            )}
          >
            {workflow.name}
          </span>
        )}
      </Link>

      {/* Context Menu */}
      <ContextMenu
        isOpen={isContextMenuOpen}
        position={position}
        menuRef={menuRef}
        onClose={closeMenu}
        onRename={handleStartEdit}
        onDelete={() => setIsDeleteModalOpen(true)}
      />

      {/* Delete Confirmation Modal */}
      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteWorkflow}
        isDeleting={isDeleting}
        itemType='workflow'
        itemName={workflow.name}
      />
    </>
  )
}
