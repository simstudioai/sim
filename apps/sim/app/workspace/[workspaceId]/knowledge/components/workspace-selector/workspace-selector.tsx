'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'

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
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertTriangle className='h-4 w-4 text-amber-500' />
          </TooltipTrigger>
          <TooltipContent side='top'>Not assigned to workspace</TooltipContent>
        </Tooltip>
      )}

      {/* Workspace selector dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            disabled={disabled || isLoading || isUpdating}
            className='h-8 gap-1 px-2 text-muted-foreground text-xs hover:text-foreground'
          >
            <span className='max-w-[120px] truncate'>
              {isLoading
                ? 'Loading...'
                : isUpdating
                  ? 'Updating...'
                  : currentWorkspace?.name || 'No workspace'}
            </span>
            <ChevronDown className='h-3 w-3' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-48'>
          {/* No workspace option */}
          <DropdownMenuItem
            onClick={() => handleWorkspaceChange(null)}
            className='flex items-center justify-between'
          >
            <span className='text-muted-foreground'>No workspace</span>
            {!currentWorkspaceId && <Check className='h-4 w-4' />}
          </DropdownMenuItem>

          {/* Available workspaces */}
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => handleWorkspaceChange(workspace.id)}
              className='flex items-center justify-between'
            >
              <div className='flex flex-col'>
                <span>{workspace.name}</span>
                <span className='text-muted-foreground text-xs capitalize'>
                  {workspace.permissions}
                </span>
              </div>
              {currentWorkspaceId === workspace.id && <Check className='h-4 w-4' />}
            </DropdownMenuItem>
          ))}

          {workspaces.length === 0 && !isLoading && (
            <DropdownMenuItem disabled>
              <span className='text-muted-foreground text-xs'>No workspaces with write access</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
