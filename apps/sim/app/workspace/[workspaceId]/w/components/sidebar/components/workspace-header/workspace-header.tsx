'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, PanelLeft } from 'lucide-react'
import Link from 'next/link'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'

const logger = createLogger('WorkspaceHeader')

/**
 * Workspace entity interface
 */
interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
}

/**
 * Main WorkspaceHeader component props
 */
interface WorkspaceHeaderProps {
  onCreateWorkflow: () => void
  isWorkspaceSelectorVisible: boolean
  onToggleWorkspaceSelector: () => void
  onToggleSidebar: () => void
  activeWorkspace: Workspace | null
  isWorkspacesLoading: boolean
  updateWorkspaceName: (workspaceId: string, newName: string) => Promise<boolean>
}

/**
 * WorkspaceHeader component - Single row header with all elements
 */
export const WorkspaceHeader = React.memo<WorkspaceHeaderProps>(
  ({
    onCreateWorkflow,
    isWorkspaceSelectorVisible,
    onToggleWorkspaceSelector,
    onToggleSidebar,
    activeWorkspace,
    isWorkspacesLoading,
    updateWorkspaceName,
  }) => {
    // External hooks
    const { data: sessionData } = useSession()
    const userPermissions = useUserPermissionsContext()
    const [isClientLoading, setIsClientLoading] = useState(true)
    const [isEditingName, setIsEditingName] = useState(false)
    const [editingName, setEditingName] = useState('')

    // Refs
    const editInputRef = useRef<HTMLInputElement>(null)

    // Computed values
    const userName = useMemo(
      () => sessionData?.user?.name || sessionData?.user?.email || 'User',
      [sessionData?.user?.name, sessionData?.user?.email]
    )
    const workspaceUrl = useMemo(
      () => (activeWorkspace ? `/workspace/${activeWorkspace.id}/w` : '/workspace'),
      [activeWorkspace]
    )

    const displayName = useMemo(
      () => activeWorkspace?.name || `${userName}'s Workspace`,
      [activeWorkspace?.name, userName]
    )

    // Effects
    useEffect(() => {
      setIsClientLoading(false)
    }, [])

    // Focus input when editing starts
    useEffect(() => {
      if (isEditingName && editInputRef.current) {
        editInputRef.current.focus()
        editInputRef.current.select()
      }
    }, [isEditingName])

    // Handle workspace name click
    const handleWorkspaceNameClick = useCallback(() => {
      // Only allow admins to rename workspace
      if (!userPermissions.canAdmin) {
        return
      }
      setEditingName(displayName)
      setIsEditingName(true)
    }, [displayName, userPermissions.canAdmin])

    // Handle workspace name editing actions
    const handleEditingAction = useCallback(
      (action: 'save' | 'cancel') => {
        switch (action) {
          case 'save': {
            // Exit edit mode immediately, save in background
            setIsEditingName(false)
            if (activeWorkspace && editingName.trim() !== '') {
              updateWorkspaceName(activeWorkspace.id, editingName.trim()).catch((error) => {
                logger.error('Failed to update workspace name:', error)
              })
            }
            break
          }

          case 'cancel': {
            // Cancel without saving
            setIsEditingName(false)
            setEditingName('')
            break
          }
        }
      },
      [activeWorkspace, editingName, updateWorkspaceName]
    )

    // Handle keyboard interactions
    const handleInputKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          handleEditingAction('save')
        } else if (e.key === 'Escape') {
          handleEditingAction('cancel')
        }
      },
      [handleEditingAction]
    )

    // Handle click away - immediate exit with background save
    const handleInputBlur = useCallback(() => {
      handleEditingAction('save')
    }, [handleEditingAction])

    // Render loading state
    const renderLoadingState = () => (
      <>
        {/* Icon */}
        <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]'>
          <AgentIcon className='h-4 w-4 text-white' />
        </div>

        {/* Loading workspace name and chevron container */}
        <div className='flex min-w-0 flex-1 items-center'>
          <div className='min-w-0 flex-1 p-1'>
            <Skeleton className='h-4 w-24' />
          </div>

          {/* Chevron */}
          <Button
            variant='ghost'
            size='icon'
            className='h-6 w-6 text-muted-foreground hover:bg-secondary'
            disabled
          >
            {isWorkspaceSelectorVisible ? (
              <ChevronUp className='h-4 w-4' />
            ) : (
              <ChevronDown className='h-4 w-4' />
            )}
          </Button>
        </div>

        {/* Toggle Sidebar - with gap-2 max from chevron */}
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            className='h-6 w-6 text-muted-foreground hover:bg-secondary'
            disabled
          >
            <PanelLeft className='h-4 w-4' />
          </Button>
        </div>
      </>
    )

    // Render workspace info
    const renderWorkspaceInfo = () => (
      <>
        {/* Icon - separate from hover area */}
        <Link
          href={workspaceUrl}
          className='group flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#802FFF]'
        >
          <AgentIcon className='h-4 w-4 text-white transition-all group-hover:scale-105' />
        </Link>

        {/* Workspace Name and Chevron Container */}
        <div className='flex min-w-0 flex-1 items-center'>
          {/* Workspace Name - Editable */}
          <div className={`flex min-w-0 items-center p-1 ${isEditingName ? 'flex-1' : ''}`}>
            {isEditingName ? (
              <input
                ref={editInputRef}
                type='text'
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={handleInputBlur}
                className='m-0 h-auto w-full resize-none truncate border-0 bg-transparent p-0 font-medium text-sm leading-none outline-none'
                style={{
                  minHeight: '1rem',
                  lineHeight: '1rem',
                }}
              />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={handleWorkspaceNameClick}
                    className={`truncate font-medium text-sm leading-none transition-all ${
                      userPermissions.canAdmin
                        ? 'cursor-pointer hover:brightness-75 dark:hover:brightness-125'
                        : 'cursor-default'
                    }`}
                    style={{
                      minHeight: '1rem',
                      lineHeight: '1rem',
                    }}
                  >
                    {displayName}
                  </div>
                </TooltipTrigger>
                {!userPermissions.canAdmin && (
                  <TooltipContent side='bottom'>
                    Admin permissions required to rename workspace
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>

          {/* Chevron - Next to name, hidden in edit mode */}
          {!isEditingName && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onToggleWorkspaceSelector}
              className='h-6 w-6 text-muted-foreground hover:bg-secondary'
            >
              {isWorkspaceSelectorVisible ? (
                <ChevronUp className='h-4 w-4' />
              ) : (
                <ChevronDown className='h-4 w-4' />
              )}
            </Button>
          )}
        </div>

        {/* Toggle Sidebar - with gap-2 max from chevron */}
        <div className='flex items-center gap-2'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={onToggleSidebar}
                className='h-6 w-6 text-muted-foreground hover:bg-secondary'
              >
                <PanelLeft className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom'>Toggle sidebar</TooltipContent>
          </Tooltip>
        </div>
      </>
    )

    // Main render - using h-12 to match control bar height
    return (
      <div className='h-12 rounded-[14px] border bg-card shadow-xs'>
        <div className='flex h-full items-center gap-1 px-3'>
          {isClientLoading || isWorkspacesLoading ? renderLoadingState() : renderWorkspaceInfo()}
        </div>
      </div>
    )
  }
)

WorkspaceHeader.displayName = 'WorkspaceHeader'
