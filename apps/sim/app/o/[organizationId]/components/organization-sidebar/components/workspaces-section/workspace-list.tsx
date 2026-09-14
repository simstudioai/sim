'use client'

import { useEffect, useState } from 'react'
import {
  chipVariants,
  cn,
  DropdownMenuItem,
  DropdownMenuItemAction,
  Loader,
  OverflowText,
  toast,
} from '@sim/emcn'
import { MoreHorizontal, Pin } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import { WorkspaceContextMenu } from '@/components/workspaces/workspace-context-menu'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import { useOrganizationWorkspaces } from '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-workspaces'
import { SidebarRenameRow } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-rename-row'
import { useFlyoutInlineRename } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-flyout-inline-rename'
import type { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import { useToggleWorkspacePin, useUpdateWorkspace } from '@/hooks/queries/workspace'
import { useContextMenu } from '@/hooks/use-context-menu'

const PAGE_SIZE = 5

interface WorkspaceListProps {
  organizationId: string
  pathname?: string | null
  /** The rail flyout uses the same actions and ordering as the expanded list. */
  flyout?: ReturnType<typeof useHoverMenu>
}

export function WorkspaceList({ organizationId, pathname, flyout }: WorkspaceListProps) {
  const { workspaces, pinnedWorkspaceIds, isLoading } = useOrganizationWorkspaces(organizationId)
  const { mutate: togglePin } = useToggleWorkspacePin()
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace()
  const menu = useContextMenu()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedId)
  const rename = useFlyoutInlineRename({
    itemType: 'workspace',
    onSave: async (workspaceId, name) => {
      try {
        await updateWorkspace({ workspaceId, name })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to rename workspace'))
        throw error
      }
    },
  })
  const lockFlyout = flyout?.setLocked
  const isInteracting = menu.isOpen || rename.editingId !== null

  useEffect(() => {
    if (!lockFlyout || !isInteracting) return
    lockFlyout(true)
    return () => lockFlyout(false)
  }, [lockFlyout, isInteracting])

  const visibleWorkspaces = flyout ? workspaces : workspaces.slice(0, visibleCount)
  const hasMore = workspaces.length > visibleCount

  const openMenu = (event: React.MouseEvent, workspaceId: string) => {
    setSelectedId(workspaceId)
    flyout?.setLocked(true)
    menu.preventDismiss()
    menu.handleContextMenu(event)
  }

  return (
    <>
      {isLoading && flyout && (
        <DropdownMenuItem disabled>
          <Loader className='size-[14px]' animate />
          Loading...
        </DropdownMenuItem>
      )}
      {!isLoading && workspaces.length === 0 && (
        <div className='px-2 py-1 text-[var(--text-muted)] text-small'>No workspaces yet</div>
      )}
      {visibleWorkspaces.map((workspace) => {
        const href = `/workspace/${workspace.id}`
        const isActive = pathname === href || Boolean(pathname?.startsWith(`${href}/`))
        const isMenuOpen = menu.isOpen && selectedId === workspace.id
        const isPinned = pinnedWorkspaceIds.has(workspace.id)
        const label = (
          <>
            <IdentityTile
              initial={getWorkspaceInitial(workspace.name)}
              logoUrl={workspace.logoUrl}
            />
            <OverflowText
              label={workspace.name}
              className='flex-1 text-[var(--text-body)]'
              focusTarget='nearest-interactive'
            />
          </>
        )
        const onMoreClick = (event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          event.stopPropagation()
          if (isMenuOpen) {
            menu.closeMenu()
            return
          }
          setSelectedId(workspace.id)
          flyout?.setLocked(true)
          const rect = event.currentTarget.getBoundingClientRect()
          menu.openMenuAt({ x: rect.right, y: rect.top })
        }

        if (rename.editingId === workspace.id) {
          return (
            <SidebarRenameRow
              key={workspace.id}
              ref={rename.inputRef}
              leadingAdornment={
                <IdentityTile
                  initial={getWorkspaceInitial(workspace.name)}
                  logoUrl={workspace.logoUrl}
                />
              }
              aria-label={`Rename workspace ${workspace.name}`}
              value={rename.value}
              onChange={(event) => rename.setValue(event.target.value)}
              onKeyDown={rename.handleKeyDown}
              onBlur={() => void rename.saveRename()}
              disabled={rename.isSaving}
            />
          )
        }

        if (flyout) {
          return (
            <DropdownMenuItem
              key={workspace.id}
              asChild
              active={isActive || isMenuOpen}
              onPointerMove={(event) => {
                if (menu.isOpen || rename.editingId) event.preventDefault()
              }}
              actionIndicator={
                isPinned ? (
                  <Pin
                    aria-hidden={false}
                    className='size-[12px] text-[var(--text-icon)]'
                    aria-label='Pinned'
                    role='img'
                  />
                ) : undefined
              }
              action={
                <DropdownMenuItemAction
                  aria-label={`Options for ${workspace.name}`}
                  onPointerDown={() => menu.preventDismiss()}
                  onClick={onMoreClick}
                >
                  <MoreHorizontal />
                </DropdownMenuItemAction>
              }
            >
              <SettingsGuardedLink
                href={href}
                onContextMenu={(event) => openMenu(event, workspace.id)}
              >
                {label}
              </SettingsGuardedLink>
            </DropdownMenuItem>
          )
        }

        return (
          <SettingsGuardedLink
            key={workspace.id}
            href={href}
            className={chipVariants({ active: isActive || isMenuOpen, fullWidth: true })}
            onContextMenu={(event) => openMenu(event, workspace.id)}
          >
            {label}
            <div className='relative flex size-[18px] shrink-0 items-center justify-center'>
              {isPinned && (
                <Pin
                  role='img'
                  aria-label='Pinned'
                  className={cn(
                    'absolute size-[12px] text-[var(--text-icon)] group-focus-within:opacity-0 group-hover:opacity-0',
                    isMenuOpen && 'opacity-0'
                  )}
                />
              )}
              <button
                type='button'
                aria-label={`Options for ${workspace.name}`}
                onPointerDown={() => menu.preventDismiss()}
                onClick={onMoreClick}
                className={cn(
                  'absolute inset-0 flex items-center justify-center rounded-sm opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                  isMenuOpen && 'opacity-100'
                )}
              >
                <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
              </button>
            </div>
          </SettingsGuardedLink>
        )
      })}
      {!flyout && workspaces.length > PAGE_SIZE && (
        <button
          type='button'
          onClick={() => setVisibleCount((count) => (hasMore ? count + PAGE_SIZE : PAGE_SIZE))}
          className={cn(chipVariants({ fullWidth: true }), 'text-[var(--text-muted)] text-small')}
        >
          {hasMore ? 'See more' : 'See less'}
        </button>
      )}
      <WorkspaceContextMenu
        workspace={selectedWorkspace}
        workspaceCount={workspaces.length}
        isOpen={menu.isOpen}
        position={menu.position}
        menuRef={menu.menuRef}
        onClose={menu.closeMenu}
        renameInputRef={rename.inputRef}
        showDelete={false}
        showDuplicate={false}
        showOpenInNewTab
        onOpenInNewTab={() => {
          if (selectedWorkspace)
            window.open(`/workspace/${selectedWorkspace.id}`, '_blank', 'noopener,noreferrer')
        }}
        onRename={() => {
          if (selectedWorkspace?.permissions === 'admin') rename.startRename(selectedWorkspace)
        }}
        isPinned={Boolean(selectedId && pinnedWorkspaceIds.has(selectedId))}
        onTogglePin={() => {
          if (selectedWorkspace) {
            togglePin(
              {
                workspaceId: selectedWorkspace.id,
                pinned: !pinnedWorkspaceIds.has(selectedWorkspace.id),
              },
              { onError: (error) => toast.error(error.message) }
            )
          }
        }}
      />
    </>
  )
}
