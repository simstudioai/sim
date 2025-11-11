'use client'

import { Plus } from 'lucide-react'
import {
  Button,
  ChevronDown,
  PanelLeft,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  PopoverTrigger,
} from '@/components/emcn'

interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
}

interface WorkspaceHeaderProps {
  /**
   * The active workspace object
   */
  activeWorkspace?: { name: string } | null
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * List of available workspaces
   */
  workspaces: Workspace[]
  /**
   * Whether workspaces are loading
   */
  isWorkspacesLoading: boolean
  /**
   * Whether workspace creation is in progress
   */
  isCreatingWorkspace: boolean
  /**
   * Whether the workspace menu popover is open
   */
  isWorkspaceMenuOpen: boolean
  /**
   * Callback to set workspace menu open state
   */
  setIsWorkspaceMenuOpen: (isOpen: boolean) => void
  /**
   * Callback when workspace is switched
   */
  onWorkspaceSwitch: (workspace: Workspace) => void
  /**
   * Callback when create workspace is clicked
   */
  onCreateWorkspace: () => Promise<void>
  /**
   * Callback when toggle collapse is clicked
   */
  onToggleCollapse: () => void
  /**
   * Whether the sidebar is collapsed
   */
  isCollapsed: boolean
}

/**
 * Workspace header component that displays workspace name, switcher, and collapse toggle.
 * Used in both the full sidebar and floating collapsed state.
 */
export function WorkspaceHeader({
  activeWorkspace,
  workspaceId,
  workspaces,
  isWorkspacesLoading,
  isCreatingWorkspace,
  isWorkspaceMenuOpen,
  setIsWorkspaceMenuOpen,
  onWorkspaceSwitch,
  onCreateWorkspace,
  onToggleCollapse,
  isCollapsed,
}: WorkspaceHeaderProps) {
  return (
    <div className='flex items-center justify-between gap-[8px]'>
      {/* Workspace Name */}
      <div className='flex min-w-0 items-center gap-[8px]'>
        <h2
          className='truncate font-base text-[14px] dark:text-[#FFFFFF]'
          title={activeWorkspace?.name || 'Loading...'}
        >
          {activeWorkspace?.name || 'Loading...'}
        </h2>
      </div>
      {/* Workspace Actions */}
      <div className='flex items-center gap-[12px]'>
        {/* Workspace Switcher Popover */}
        <Popover open={isWorkspaceMenuOpen} onOpenChange={setIsWorkspaceMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant='ghost-secondary'
              type='button'
              aria-label='Switch workspace'
              className='group !p-[3px] -m-[3px]'
            >
              <ChevronDown
                className={`h-[8px] w-[12px] transition-transform duration-100 ${
                  isWorkspaceMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent align='end' side='bottom' sideOffset={8}>
            {isWorkspacesLoading ? (
              <PopoverItem disabled>
                <span>Loading workspaces...</span>
              </PopoverItem>
            ) : (
              <>
                {workspaces.length > 0 && (
                  <>
                    <PopoverSection>Workspaces</PopoverSection>
                    {workspaces.map((workspace, index) => (
                      <PopoverItem
                        key={workspace.id}
                        active={workspace.id === workspaceId}
                        onClick={() => onWorkspaceSwitch(workspace)}
                        className={index > 0 ? 'mt-[2px]' : ''}
                      >
                        <span>{workspace.name}</span>
                      </PopoverItem>
                    ))}
                  </>
                )}
                <PopoverItem
                  onClick={async () => {
                    await onCreateWorkspace()
                    setIsWorkspaceMenuOpen(false)
                  }}
                  disabled={isCreatingWorkspace}
                  className={workspaces.length > 0 ? 'mt-[2px]' : ''}
                >
                  <Plus className='h-3 w-3' />
                  <span>Create a workspace</span>
                </PopoverItem>
              </>
            )}
          </PopoverContent>
        </Popover>
        {/* Sidebar Collapse Toggle */}
        <Button
          variant='ghost-secondary'
          type='button'
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className='group !p-[3px] -m-[3px]'
          onClick={onToggleCollapse}
        >
          <PanelLeft className='h-[17.5px] w-[17.5px]' />
        </Button>
      </div>
    </div>
  )
}
