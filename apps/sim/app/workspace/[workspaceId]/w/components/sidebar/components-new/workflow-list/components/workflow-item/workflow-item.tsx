'use client'

import { useRef, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  level: number
}

export function WorkflowItem({ workflow, active, level }: WorkflowItemProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [isDragging, setIsDragging] = useState(false)
  const shouldPreventClickRef = useRef(false)
  const { selectedWorkflows, selectOnly, toggleWorkflowSelection } = useFolderStore()
  const isSelected = selectedWorkflows.has(workflow.id)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (shouldPreventClickRef.current) {
      e.preventDefault()
      return
    }

    if (e.shiftKey) {
      e.preventDefault()
      toggleWorkflowSelection(workflow.id)
    } else {
      if (!isSelected || selectedWorkflows.size > 1) {
        selectOnly(workflow.id)
      }
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    shouldPreventClickRef.current = true
    setIsDragging(true)

    let workflowIds: string[]
    if (isSelected && selectedWorkflows.size > 1) {
      workflowIds = Array.from(selectedWorkflows)
    } else {
      workflowIds = [workflow.id]
    }

    e.dataTransfer.setData('workflow-ids', JSON.stringify(workflowIds))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    requestAnimationFrame(() => {
      shouldPreventClickRef.current = false
    })
  }

  return (
    <Link
      href={`/workspace/${workspaceId}/w/${workflow.id}`}
      className={clsx(
        'group flex h-[25px] items-center gap-[8px] rounded-[8px] px-[5px] text-[14px]',
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
