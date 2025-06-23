'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { PanelLeftClose, PanelRight, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUserPermissionsContext } from '@/app/w/components/providers/workspace-permissions-provider'
import { getAllBlocks, getBlocksByCategory } from '@/blocks'
import type { BlockCategory } from '@/blocks/types'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { ToolbarBlock } from './components/toolbar-block/toolbar-block'
import LoopToolbarItem from './components/toolbar-loop-block/toolbar-loop-block'
import ParallelToolbarItem from './components/toolbar-parallel-block/toolbar-parallel-block'
import { ToolbarTabs } from './components/toolbar-tabs/toolbar-tabs'

interface ToolbarButtonProps {
  onClick: () => void
  className: string
  children: React.ReactNode
  tooltipContent: string
  tooltipSide?: 'left' | 'right' | 'top' | 'bottom'
}

const ToolbarButton = React.memo<ToolbarButtonProps>(
  ({ onClick, className, children, tooltipContent, tooltipSide = 'right' }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} className={className}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltipContent}</TooltipContent>
    </Tooltip>
  )
)

ToolbarButton.displayName = 'ToolbarButton'

export const Toolbar = React.memo(() => {
  const params = useParams()
  const workflowId = params?.id as string

  // Get the workspace ID from the workflow registry
  const { activeWorkspaceId, workflows } = useWorkflowRegistry()

  const currentWorkflow = useMemo(
    () => (workflowId ? workflows[workflowId] : null),
    [workflowId, workflows]
  )

  const workspaceId = currentWorkflow?.workspaceId || activeWorkspaceId

  const userPermissions = useUserPermissionsContext()

  const [activeTab, setActiveTab] = useState<BlockCategory>('blocks')
  const [searchQuery, setSearchQuery] = useState('')
  const { mode, isExpanded } = useSidebarStore()

  // In hover mode, act as if sidebar is always collapsed for layout purposes
  const isSidebarCollapsed = useMemo(
    () => (mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'),
    [mode, isExpanded]
  )

  // State to track if toolbar is open - independent of sidebar state
  const [isToolbarOpen, setIsToolbarOpen] = useState(true)

  const blocks = useMemo(() => {
    const filteredBlocks = !searchQuery.trim() ? getBlocksByCategory(activeTab) : getAllBlocks()

    return filteredBlocks.filter((block) => {
      if (block.type === 'starter' || block.hideFromToolbar) return false

      return (
        !searchQuery.trim() ||
        block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [searchQuery, activeTab])

  const handleOpenToolbar = useCallback(() => {
    setIsToolbarOpen(true)
  }, [])

  const handleCloseToolbar = useCallback(() => {
    setIsToolbarOpen(false)
  }, [])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleTabChange = useCallback((tab: BlockCategory) => {
    setActiveTab(tab)
  }, [])

  // Show toolbar button when it's closed, regardless of sidebar state
  if (!isToolbarOpen) {
    return (
      <ToolbarButton
        onClick={handleOpenToolbar}
        className={`fixed transition-all duration-200 ${isSidebarCollapsed ? 'left-20' : 'left-64'} bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground hover:bg-accent hover:text-foreground`}
        tooltipContent='Open Toolbar'
        tooltipSide='right'
      >
        <PanelRight className='h-5 w-5' />
        <span className='sr-only'>Open Toolbar</span>
      </ToolbarButton>
    )
  }

  return (
    <div
      className={`fixed transition-all duration-200 ${isSidebarCollapsed ? 'left-14' : 'left-60'} top-16 z-10 h-[calc(100vh-4rem)] w-60 border-r bg-background sm:block`}
    >
      <div className='flex h-full flex-col'>
        <div className='sticky top-0 z-20 bg-background px-4 pt-4 pb-1'>
          <div className='relative'>
            <Search className='-translate-y-[50%] absolute top-[50%] left-3 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search...'
              className='rounded-md pl-9'
              value={searchQuery}
              onChange={handleSearchChange}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          </div>
        </div>

        {!searchQuery && (
          <div className='sticky top-[72px] z-20 bg-background'>
            <ToolbarTabs activeTab={activeTab} onTabChange={handleTabChange} />
          </div>
        )}

        <ScrollArea className='h-[calc(100%-4rem)]'>
          <div className='p-4 pb-20'>
            <div className='flex flex-col gap-3'>
              {blocks.map((block) => (
                <ToolbarBlock key={block.type} config={block} disabled={!userPermissions.canEdit} />
              ))}
              {activeTab === 'blocks' && !searchQuery && (
                <>
                  <LoopToolbarItem disabled={!userPermissions.canEdit} />
                  <ParallelToolbarItem disabled={!userPermissions.canEdit} />
                </>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className='absolute right-0 bottom-0 left-0 h-16 border-t bg-background'>
          <ToolbarButton
            onClick={handleCloseToolbar}
            className='absolute right-4 bottom-[18px] flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground'
            tooltipContent='Close Toolbar'
            tooltipSide='left'
          >
            <PanelLeftClose className='h-5 w-5' />
            <span className='sr-only'>Close Toolbar</span>
          </ToolbarButton>
        </div>
      </div>
    </div>
  )
})

Toolbar.displayName = 'Toolbar'
