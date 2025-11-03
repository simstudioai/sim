'use client'

import { useCallback } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useItemDrag } from '../../../../hooks/use-item-drag'

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
  const isSelected = selectedWorkflows.has(workflow.id)

  /**
   * Drag start handler - handles workflow dragging with multi-selection support
   *
   * @param e - React drag event
   */
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
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

  /**
   * Handle click - manages workflow selection with shift-key and cmd/ctrl-key support
   *
   * @param e - React mouse event
   */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.stopPropagation()

      if (shouldPreventClickRef.current) {
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
    [shouldPreventClickRef, workflow.id, onWorkflowClick]
  )

  return (
    <Link
      href={`/workspace/${workspaceId}/w/${workflow.id}`}
      data-item-id={workflow.id}
      className={clsx(
        'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5.5px] text-[14px]',
        active ? 'bg-[#2C2C2C] dark:bg-[#2C2C2C]' : 'hover:bg-[#2C2C2C] dark:hover:bg-[#2C2C2C]',
        isSelected && selectedWorkflows.size > 1 && !active ? 'bg-[#2C2C2C] dark:bg-[#2C2C2C]' : '',
        isDragging ? 'opacity-50' : ''
      )}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
    >
      <div
        className='h-[16px] w-[16px] flex-shrink-0 rounded-[4px]'
        style={{ backgroundColor: workflow.color }}
      />
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
    </Link>
  )
}
