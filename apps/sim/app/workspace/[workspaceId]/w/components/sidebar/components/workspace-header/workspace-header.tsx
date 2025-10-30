'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, PanelLeft } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'

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
  }) => {
    // External hooks
    const { data: sessionData } = useSession()
    const [isClientLoading, setIsClientLoading] = useState(true)

    // Computed values
    const userName = useMemo(
      () => sessionData?.user?.name || sessionData?.user?.email || 'User',
      [sessionData?.user?.name, sessionData?.user?.email]
    )

    const displayName = useMemo(
      () => activeWorkspace?.name || `${userName}'s Workspace`,
      [activeWorkspace?.name, userName]
    )

    // Effects
    useEffect(() => {
      setIsClientLoading(false)
    }, [])

    // Handle header click to toggle workspace selector
    const handleHeaderClick = useCallback(() => {
      onToggleWorkspaceSelector()
    }, [onToggleWorkspaceSelector])

    // Handle sidebar toggle click
    const handleSidebarToggle = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation() // Prevent header click
        onToggleSidebar()
      },
      [onToggleSidebar]
    )

    // Render loading state
    const renderLoadingState = () => (
      <>
        {/* Loading workspace name - matches actual layout */}
        <div className='flex min-w-0 flex-1 items-center pl-1'>
          <Skeleton className='h-4 w-24' />
        </div>

        {/* Chevron - actual element, not skeleton */}
        <div className='flex h-5 w-5 items-center justify-center text-muted-foreground'>
          {!isWorkspaceSelectorVisible ? (
            <ChevronUp className='h-4 w-4' />
          ) : (
            <ChevronDown className='h-4 w-4' />
          )}
        </div>

        {/* Toggle Sidebar - actual element, not skeleton */}
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:bg-secondary'
          disabled
        >
          <PanelLeft className='h-4 w-4' />
        </Button>
      </>
    )

    // Render workspace info
    const renderWorkspaceInfo = () => (
      <>
        {/* Workspace Name - Display only */}
        <div className='flex min-w-0 flex-1 items-center pl-1'>
          <span
            className='truncate font-medium text-sm leading-none'
            style={{
              minHeight: '1rem',
              lineHeight: '1rem',
            }}
          >
            {displayName}
          </span>
        </div>

        {/* Chevron - Display only */}
        <div className='flex h-5 w-5 items-center justify-center text-muted-foreground'>
          {!isWorkspaceSelectorVisible ? (
            <ChevronUp className='h-4 w-4' />
          ) : (
            <ChevronDown className='h-4 w-4' />
          )}
        </div>

        {/* Toggle Sidebar - with gap-1 from chevron */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={handleSidebarToggle}
              className='h-6 w-6 text-muted-foreground hover:bg-secondary'
            >
              <PanelLeft className='h-4 w-4' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Toggle sidebar</Tooltip.Content>
        </Tooltip.Root>
      </>
    )

    // Main render - using h-12 to match control bar height
    return (
      <div className='h-12 rounded-[10px] border bg-background shadow-xs'>
        <div
          className='flex h-full cursor-pointer items-center gap-1 rounded-[10px] pr-[10px] pl-3 transition-colors hover:bg-muted/50'
          onClick={handleHeaderClick}
        >
          {isClientLoading || isWorkspacesLoading ? renderLoadingState() : renderWorkspaceInfo()}
        </div>
      </div>
    )
  }
)

WorkspaceHeader.displayName = 'WorkspaceHeader'
