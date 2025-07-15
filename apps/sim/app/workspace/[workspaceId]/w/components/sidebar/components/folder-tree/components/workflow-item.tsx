'use client'

import { useRef, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useFolderStore, useIsWorkflowSelected } from '@/stores/folders/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { WorkflowContextMenu } from '../../workflow-context-menu/workflow-context-menu'

const logger = createLogger('WorkflowItem')

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  isMarketplace?: boolean
  isCollapsed?: boolean
  level: number
  isDragOver?: boolean
  isFirstItem?: boolean
}

export function WorkflowItem({
  workflow,
  active,
  isMarketplace,
  isCollapsed,
  level,
  isDragOver = false,
  isFirstItem = false,
}: WorkflowItemProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragStartedRef = useRef(false)
  const params = useParams()
  const workspaceId = params.workspaceId as string
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
            href={`/workspace/${workspaceId}/w/${workflow.id}`}
            data-workflow-id={workflow.id}
            className={clsx(
              'mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              active && !isDragOver
                ? 'bg-accent text-foreground'
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
          <p className='max-w-[200px] break-words'>
            {workflow.name}
            {isMarketplace && ' (Preview)'}
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className='group mb-1'>
      <div
        className={clsx(
          'flex h-9 items-center rounded-lg px-2 py-2 font-medium text-sm transition-colors',
          active && !isDragOver
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50',
          isSelected && selectedWorkflows.size > 1 && !active && !isDragOver ? 'bg-accent/70' : '',
          isDragging ? 'opacity-50' : '',
          'cursor-pointer',
          isFirstItem ? 'mr-[44px]' : ''
        )}
        style={{
          maxWidth: isFirstItem
            ? `${164 - (level >= 0 ? (level + 1) * 20 + 8 : 0) - (level > 0 ? 8 : 0)}px`
            : `${206 - (level >= 0 ? (level + 1) * 20 + 8 : 0) - (level > 0 ? 8 : 0)}px`,
        }}
        draggable={!isMarketplace}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        data-workflow-id={workflow.id}
      >
        <Link
          href={`/workspace/${workspaceId}/w/${workflow.id}`}
          className='flex min-w-0 flex-1 items-center'
          onClick={handleClick}
        >
          <div
            className='mr-2 h-[14px] w-[14px] flex-shrink-0 rounded'
            style={{ backgroundColor: workflow.color }}
          />
          <span className='flex-1 select-none truncate'>
            {workflow.name}
            {isMarketplace && ' (Preview)'}
          </span>
        </Link>

        {!isMarketplace && (
          <div className='flex items-center justify-center' onClick={(e) => e.stopPropagation()}>
            <WorkflowContextMenu workflow={workflow} level={level} />
          </div>
        )}
      </div>
    </div>
  )
}
