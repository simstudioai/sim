'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useFolderStore, useIsWorkflowSelected } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(workflow.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const dragStartedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { selectedWorkflows, selectOnly, toggleWorkflowSelection } = useFolderStore()
  const isSelected = useIsWorkflowSelected(workflow.id)
  const { updateWorkflow } = useWorkflowRegistry()

  // Update editValue when workflow name changes
  useEffect(() => {
    setEditValue(workflow.name)
  }, [workflow.name])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (isMarketplace) return
    setIsEditing(true)
    setEditValue(workflow.name)
  }

  const handleSaveEdit = async () => {
    if (!editValue.trim() || editValue.trim() === workflow.name) {
      setIsEditing(false)
      setEditValue(workflow.name)
      return
    }

    setIsRenaming(true)
    try {
      await updateWorkflow(workflow.id, { name: editValue.trim() })
      logger.info(`Successfully renamed workflow from "${workflow.name}" to "${editValue.trim()}"`)
      setIsEditing(false)
    } catch (error) {
      logger.error('Failed to rename workflow:', {
        error,
        workflowId: workflow.id,
        oldName: workflow.name,
        newName: editValue.trim(),
      })
      // Reset to original name on error
      setEditValue(workflow.name)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(workflow.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    handleSaveEdit()
  }

  const handleClick = (e: React.MouseEvent) => {
    if (dragStartedRef.current || isEditing) {
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
    if (isMarketplace || isEditing) return

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
            draggable={!isMarketplace && !isEditing}
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
        draggable={!isMarketplace && !isEditing}
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
          {isEditing ? (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className='h-6 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              maxLength={100}
              disabled={isRenaming}
              onClick={(e) => e.preventDefault()} // Prevent navigation when clicking input
            />
          ) : (
            <span className='flex-1 select-none truncate'>
              {workflow.name}
              {isMarketplace && ' (Preview)'}
            </span>
          )}
        </Link>

        {!isMarketplace && !isEditing && (
          <div className='flex items-center justify-center' onClick={(e) => e.stopPropagation()}>
            <WorkflowContextMenu onStartEdit={handleStartEdit} />
          </div>
        )}
      </div>
    </div>
  )
}
