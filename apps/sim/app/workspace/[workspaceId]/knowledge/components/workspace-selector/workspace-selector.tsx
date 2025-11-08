'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console/logger'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'
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

        // Update the store immediately to reflect the change without page reload
        updateKnowledgeBase(knowledgeBaseId, { workspaceId: workspaceId || undefined })

        // Notify parent component of the change
        onWorkspaceChange?.(workspaceId)
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size='sm'
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
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          side='bottom'
          avoidCollisions={false}
          sideOffset={4}
          className={dropdownContentClass}
        >
          <div className={`${commandListClass} py-1`}>
            {/* No workspace option */}
            <DropdownMenuItem
              onClick={() => handleWorkspaceChange(null)}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <span className='text-muted-foreground'>No workspace</span>
              {!currentWorkspaceId && <Check className='h-4 w-4 text-muted-foreground' />}
            </DropdownMenuItem>

            {/* Available workspaces */}
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => handleWorkspaceChange(workspace.id)}
                className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
              >
                <div className='flex flex-col'>
                  <span>{workspace.name}</span>
                  <span className='text-muted-foreground text-xs capitalize'>
                    {workspace.permissions}
                  </span>
                </div>
                {currentWorkspaceId === workspace.id && (
                  <Check className='h-4 w-4 text-muted-foreground' />
                )}
              </DropdownMenuItem>
            ))}

            {workspaces.length === 0 && !isLoading && (
              <DropdownMenuItem disabled className='px-3 py-2'>
                <span className='text-muted-foreground text-xs'>
                  No workspaces with write access
                </span>
              </DropdownMenuItem>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
