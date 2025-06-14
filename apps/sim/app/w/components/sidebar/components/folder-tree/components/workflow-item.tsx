'use client'

import { useRef, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFolderStore, useIsWorkflowSelected } from '@/stores/folders/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  isMarketplace?: boolean
  isCollapsed?: boolean
  level: number
  isDragOver?: boolean
}

export function WorkflowItem({
  workflow,
  active,
  isMarketplace,
  isCollapsed,
  level,
  isDragOver = false,
}: WorkflowItemProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragStartedRef = useRef(false)
  const { selectedWorkflows, selectOnly, toggleWorkflowSelection } = useFolderStore()
  const isSelected = useIsWorkflowSelected(workflow.id)

  const handleClick = (e: React.MouseEvent) => {
    if (dragStartedRef.current) {
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
    if (isMarketplace) return

    dragStartedRef.current = true
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
      dragStartedRef.current = false
    })
  }

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={`/w/${workflow.id}`}
            className={clsx(
              'mx-auto flex h-8 w-8 items-center justify-center rounded-md',
              active && !isDragOver
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
              isSelected && selectedWorkflows.size > 1 && !active && !isDragOver
                ? 'bg-accent/70'
                : '',
              isDragging ? 'opacity-50' : ''
            )}
            draggable={!isMarketplace}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
          >
            <div
              className='h-[14px] w-[14px] flex-shrink-0 rounded'
              style={{ backgroundColor: workflow.color }}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side='right'>
          <p>
            {workflow.name}
            {isMarketplace && ' (Preview)'}
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link
      href={`/w/${workflow.id}`}
      className={clsx(
        'flex items-center rounded-md px-2 py-1.5 font-medium text-sm',
        active && !isDragOver
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50',
        isSelected && selectedWorkflows.size > 1 && !active && !isDragOver ? 'bg-accent/70' : '',
        isDragging ? 'opacity-50' : '',
        !isMarketplace ? 'cursor-move' : ''
      )}
      style={{ paddingLeft: isCollapsed ? '0px' : `${(level + 1) * 20 + 8}px` }}
      draggable={!isMarketplace}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
    >
      <div
        className='mr-2 h-[14px] w-[14px] flex-shrink-0 rounded'
        style={{ backgroundColor: workflow.color }}
      />
      <span className='truncate'>
        {workflow.name}
        {isMarketplace && ' (Preview)'}
      </span>
    </Link>
  )
}
