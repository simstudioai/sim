'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { filterButtonClass } from '@/app/workspace/[workspaceId]/knowledge/components/shared'
import { useKnowledgeStore } from '@/stores/knowledge/store'

const logger = createLogger('WorkspaceSelector')

interface Workspace {
  id: string
  name: string
  permissions: 'admin' | 'write' | 'read'
}

interface WorkspaceSelectorProps {
  knowledgeBaseId: string
  currentWorkspaceId: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void
  disabled?: boolean
}

export function WorkspaceSelector({
  knowledgeBaseId,
  currentWorkspaceId,
  onWorkspaceChange,
  disabled = false,
}: WorkspaceSelectorProps) {
  const { updateKnowledgeBase } = useKnowledgeStore()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  // Fetch available workspaces
  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        setIsLoading(true)

        const response = await fetch('/api/workspaces')
        if (!response.ok) {
          throw new Error('Failed to fetch workspaces')
        }

        const data = await response.json()

        // Filter workspaces where user has write/admin permissions
        const availableWorkspaces = data.workspaces
          .filter((ws: any) => ws.permissions === 'write' || ws.permissions === 'admin')
          .map((ws: any) => ({
            id: ws.id,
            name: ws.name,
            permissions: ws.permissions,
          }))

        setWorkspaces(availableWorkspaces)
      } catch (err) {
        logger.error('Error fetching workspaces:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchWorkspaces()
  }, [])

  const handleWorkspaceChange = async (workspaceId: string | null) => {
    if (isUpdating || disabled) return

    try {
      setIsUpdating(true)
      setIsPopoverOpen(false)

      const response = await fetch(`/api/knowledge/${knowledgeBaseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to update workspace')
      }

      const result = await response.json()

      if (result.success) {
        logger.info(`Knowledge base workspace updated: ${knowledgeBaseId} -> ${workspaceId}`)

        // Notify parent component of the change to refresh data
        await onWorkspaceChange?.(workspaceId)

        // Update the store after refresh to ensure consistency
        updateKnowledgeBase(knowledgeBaseId, { workspaceId: workspaceId || undefined })
      } else {
        throw new Error(result.error || 'Failed to update workspace')
      }
    } catch (err) {
      logger.error('Error updating workspace:', err)
    } finally {
      setIsUpdating(false)
    }
  }

  const currentWorkspace = workspaces.find((ws) => ws.id === currentWorkspaceId)
  const hasWorkspace = !!currentWorkspaceId

  return (
    <div className='flex items-center gap-2'>
      {/* Warning icon for unassigned knowledge bases */}
      {!hasWorkspace && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <AlertTriangle className='h-4 w-4 text-amber-500' />
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Not assigned to workspace</Tooltip.Content>
        </Tooltip.Root>
      )}

      {/* Workspace selector dropdown */}
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            disabled={disabled || isLoading || isUpdating}
            className={filterButtonClass}
          >
            <span className='truncate'>
              {isLoading
                ? 'Loading...'
                : isUpdating
                  ? 'Updating...'
                  : currentWorkspace?.name || 'No workspace'}
            </span>
            <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='end' side='bottom' sideOffset={4}>
          {/* No workspace option */}
          <PopoverItem
            active={!currentWorkspaceId}
            showCheck
            onClick={() => handleWorkspaceChange(null)}
          >
            <span className='text-muted-foreground'>No workspace</span>
          </PopoverItem>

          {/* Available workspaces */}
          {workspaces.map((workspace) => (
            <PopoverItem
              key={workspace.id}
              active={currentWorkspaceId === workspace.id}
              showCheck
              onClick={() => handleWorkspaceChange(workspace.id)}
            >
              {workspace.name}
            </PopoverItem>
          ))}

          {workspaces.length === 0 && !isLoading && (
            <PopoverItem disabled>
              <span className='text-muted-foreground text-xs'>No workspaces with write access</span>
            </PopoverItem>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
