'use client'

import { useCallback, useRef, useState } from 'react'
import {
  ChipTag,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowText,
  RowActions,
  rowActionsGroupClass,
} from '@sim/emcn'
import {
  Duplicate,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SquareArrowUpRight,
  Trash,
} from '@sim/emcn/icons'
import Link from 'next/link'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { Project } from '@/app/playground/org/lib/project'
import { useProjectActions } from '@/app/playground/org/lib/use-project-actions'
import type { ProjectDragProps } from '@/app/playground/org/lib/use-project-order'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SidebarRowAction } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-row-actions'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import {
  useItemDrag,
  useItemRename,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { createSidebarDragGhost } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { useContextMenu } from '@/hooks/use-context-menu'

interface ProjectRowProps {
  project: Project
  href: string
  newChatHref: string
  active: boolean
  /** Whether the chats under the row are shown; undefined when there are none to show. */
  expanded?: boolean
  needsYou: number
  railCollapsed: boolean
  drag: ProjectDragProps
  isAnyDragActive: boolean
  onToggleExpand: () => void
}

/**
 * A project in the organization sidebar with the workspace sidebar's row ergonomics: hover
 * reveals the options menu and a new-chat button, right-click opens the same menu, double-click
 * or Rename edits the name inline, drag reorders, and the menu pins or deletes the project.
 */
export function ProjectRow({
  project,
  href,
  newChatHref,
  active,
  expanded,
  needsYou,
  railCollapsed,
  drag,
  isAnyDragActive,
  onToggleExpand,
}: ProjectRowProps) {
  const actions = useProjectActions()
  const pinned = actions.isPinned(project)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const dragGhostRef = useRef<HTMLElement | null>(null)

  const {
    isOpen: menuOpen,
    position,
    menuRef,
    handleContextMenu,
    openMenuAt,
    closeMenu,
  } = useContextMenu()

  const rename = useItemRename({
    initialName: project.name,
    onSave: (name) => actions.rename(project, name),
    itemType: 'workspace',
    itemId: project.id,
  })

  const { isDragging, shouldPreventClickRef, handleDragStart, handleDragEnd } = useItemDrag({
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      const ghost = createSidebarDragGhost(project.name)
      void ghost.offsetHeight
      event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
      dragGhostRef.current = ghost
      drag.onDragStart()
    },
  })

  const onDragEnd = useCallback(() => {
    dragGhostRef.current?.remove()
    dragGhostRef.current = null
    handleDragEnd()
    drag.onDragEnd()
  }, [drag, handleDragEnd])

  const openMenuFromButton = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    openMenuAt({ x: rect.right, y: rect.bottom })
  }

  const openInNewTab = () => window.open(href, '_blank', 'noopener')
  const copyLink = () => void navigator.clipboard.writeText(`${window.location.origin}${href}`)

  return (
    <>
      <SidebarTooltip label={project.name} enabled={railCollapsed}>
        <div
          className={cn(
            chipVariants({ active: active || menuOpen, fullWidth: true }),
            SIDEBAR_RAIL_CHIP_CLASS,
            rowActionsGroupClass,
            'group/project relative',
            isDragging && 'opacity-50'
          )}
          draggable={!rename.isEditing && !railCollapsed}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          onDragOver={drag.onDragOver}
          onDragLeave={drag.onDragLeave}
          onDrop={drag.onDrop}
          onContextMenu={project.isMock ? undefined : handleContextMenu}
        >
          {drag.indicator && (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute right-1 left-1 h-[2px] rounded-full bg-[var(--brand-primary)]',
                drag.indicator === 'before' ? '-top-[2px]' : '-bottom-[2px]'
              )}
            />
          )}
          {rename.isEditing ? (
            <div className='flex min-w-0 flex-1 items-center gap-2'>
              <IdentityTile initial={project.name[0]} />
              <input
                ref={rename.inputRef}
                value={rename.editValue}
                onChange={(event) => rename.setEditValue(event.target.value)}
                onKeyDown={rename.handleKeyDown}
                onBlur={rename.handleInputBlur}
                disabled={rename.isRenaming}
                onClick={(event) => event.stopPropagation()}
                className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-hidden focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
                maxLength={100}
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                spellCheck={false}
              />
            </div>
          ) : (
            <Link
              href={href}
              onClick={(event) => {
                if (shouldPreventClickRef.current) {
                  event.preventDefault()
                  return
                }
                onToggleExpand()
              }}
              onDoubleClick={(event) => {
                if (project.isMock) return
                event.preventDefault()
                rename.handleStartEdit()
              }}
              aria-expanded={expanded}
              className='flex min-w-0 flex-1 items-center gap-2'
            >
              <IdentityTile initial={project.name[0]} />
              <OverflowText
                label={project.name}
                className='sidebar-collapse-hide flex-1 text-[var(--text-body)]'
                focusTarget='nearest-interactive'
              />
            </Link>
          )}
          {!railCollapsed && !rename.isEditing && (
            <RowActions
              open={menuOpen}
              revealOnHover={!isAnyDragActive}
              indicator={
                needsYou > 0 ? (
                  <ChipTag variant='gray' aria-label={`${needsYou} waiting on you`}>
                    {needsYou}
                  </ChipTag>
                ) : pinned ? (
                  <Pin className='size-[12px] text-[var(--text-icon)]' aria-label='Pinned' />
                ) : undefined
              }
            >
              <Link
                href={newChatHref}
                aria-label={`New chat in ${project.name}`}
                title={`New chat in ${project.name}`}
                className='flex size-[18px] shrink-0 items-center justify-center rounded-[4px] hover-hover:bg-[var(--surface-active)]'
              >
                <Plus className='size-[12px] text-[var(--text-icon)]' />
              </Link>
              {!project.isMock && (
                <SidebarRowAction aria-label='Project options' onClick={openMenuFromButton}>
                  <MoreHorizontal className='size-[16px] text-[var(--text-icon)]' />
                </SidebarRowAction>
              )}
            </RowActions>
          )}
        </div>
      </SidebarTooltip>

      <DropdownMenu open={menuOpen} onOpenChange={(open) => !open && closeMenu()} modal={false}>
        <DropdownMenuTrigger asChild>
          <div
            style={{
              position: 'fixed',
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: '1px',
              height: '1px',
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={menuRef}
          align='start'
          side='bottom'
          sideOffset={4}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem onSelect={openInNewTab}>
            <SquareArrowUpRight />
            Open in new tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copyLink}>
            <Duplicate />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => rename.handleStartEdit()}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.setPinned(project, !pinned)}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)}>
            <Trash />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          void actions.remove(project).finally(() => setDeleteOpen(false))
        }}
        isDeleting={actions.isDeleting}
        itemType='workspace'
        itemName={
          project.environments.length > 1
            ? `${project.name} (${project.environments.length} environments)`
            : project.name
        }
      />
    </>
  )
}
