import { type MouseEvent as ReactMouseEvent, useState } from 'react'
import {
  Chip,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemAction,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Loader,
  OverflowText,
} from '@sim/emcn'
import { MoreHorizontal, Pencil, Pin, Plus, SquareArrowUpRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import type { FlyoutEntry } from '@/app/workspace/[workspaceId]/components/folders'
import { ChatNavigationLink } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/chat-navigation-link/chat-navigation-link'
import {
  SidebarNavChip,
  type SidebarNavItemData,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-nav-chip'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import type { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { interleaveSiblings } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface CollapsedResourceFlyoutProps {
  entries: FlyoutEntry[]
  /** Resource open on the current route, so its row reads as selected. */
  currentItemId?: string
  /**
   * True until the lists that decide which rows EXIST have resolved once — the resources and
   * their folders. Both are needed before anything renders: a resource whose folder has not
   * arrived yet would show at the root and then jump into it. Pins are deliberately not
   * waited on, since they only reorder rows that are already correct.
   */
  isLoading?: boolean
  emptyLabel: string
}

/**
 * Rail flyout body for a foldered workspace resource (Tables, Files). Every row
 * is a link — the flyout is a jump list, so folders open as submenus rather than
 * navigating, and an empty one has nowhere to go and is inert. Rows carry no
 * glyph: the rail chip the flyout hangs off already names the resource, so a
 * repeated icon on every row is noise in a list that exists only to be scanned.
 */
export function CollapsedResourceFlyout({
  entries,
  currentItemId,
  isLoading = false,
  emptyLabel,
}: CollapsedResourceFlyoutProps) {
  if (isLoading) {
    return (
      <DropdownMenuItem disabled>
        <Loader className='size-[14px]' animate />
        Loading...
      </DropdownMenuItem>
    )
  }
  if (entries.length === 0) {
    return <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
  }
  return <CollapsedFlyoutRows entries={entries} currentItemId={currentItemId} />
}

/**
 * Matches the glyph `Resource`'s label cell renders: pinned rows sort to the top of every
 * list, and the ordering reads as arbitrary without it. Non-interactive here too — pinning
 * is an action on the row's own menu, not something a jump list offers.
 */
function PinnedGlyph() {
  return (
    <Pin className='size-[12px] shrink-0 text-[var(--text-icon)]' role='img' aria-label='Pinned' />
  )
}

function CollapsedFlyoutRows({
  entries,
  currentItemId,
}: Pick<CollapsedResourceFlyoutProps, 'entries' | 'currentItemId'>) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === 'item') {
          return (
            <DropdownMenuItem key={entry.id} asChild active={currentItemId === entry.id}>
              <Link href={entry.href}>
                <OverflowText label={entry.name} />
                {entry.pinned && <PinnedGlyph />}
              </Link>
            </DropdownMenuItem>
          )
        }

        if (entry.children.length === 0) {
          return (
            <DropdownMenuItem key={entry.id} disabled>
              <OverflowText label={entry.name} />
              {entry.pinned && <PinnedGlyph />}
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger>
              <OverflowText label={entry.name} />
              {entry.pinned && <PinnedGlyph />}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <CollapsedFlyoutRows entries={entry.children} currentItemId={currentItemId} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}

/**
 * Rail trigger for a menu whose nav item also has a page of its own. The chip stays the
 * ordinary nav chip, so the flyout is purely additive: clicking still opens the resource's
 * list page, and right-click still reaches the nav item's context menu.
 */
export interface CollapsedSidebarMenuNavLink {
  item: SidebarNavItemData
  active: boolean
  onContextMenu?: (e: ReactMouseEvent, href: string) => void
}

type CollapsedSidebarMenuProps = {
  hover: ReturnType<typeof useHoverMenu>
  children: React.ReactNode
  primaryAction?: {
    label: string
    onSelect: () => void
  }
} & (
  | { icon: React.ReactNode; ariaLabel?: string; navLink?: never }
  | { icon?: never; ariaLabel?: never; navLink: CollapsedSidebarMenuNavLink }
)

interface CollapsedChatFlyoutItemProps {
  chat: { id: string; href: string; name: string; isActive?: boolean; isUnread?: boolean }
  isCurrentRoute: boolean
  isMenuOpen?: boolean
  isEditing?: boolean
  editValue?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  isRenaming?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onContextMenu?: (e: ReactMouseEvent, chatId: string) => void
  onMorePointerDown?: () => void
  onMoreClick?: (e: ReactMouseEvent<HTMLButtonElement>, chatId: string) => void
}

interface CollapsedWorkflowFlyoutItemProps {
  workflow: WorkflowMetadata
  href: string
  isCurrentRoute?: boolean
  isEditing?: boolean
  editValue?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  isRenaming?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onOpenInNewTab?: () => void
  onRename?: () => void
  canRename?: boolean
}

/**
 * Suppresses the Radix menu row's own pointer handlers, which focus the row on
 * `pointermove` and hand focus back to the flyout content on `pointerleave`.
 * A submenu closes on any focus that is not its trigger, so while this row's
 * actions submenu is open those two handlers would close it the instant the
 * cursor moved — the path a right-click takes, since it opens the submenu with
 * the cursor still over the row rather than over the trigger. Radix composes
 * consumer handlers ahead of its own and skips its own once the event is
 * defaulted, so preventing default here holds focus still until the cursor
 * reaches the submenu. Only applied to the row whose submenu is open: moving on
 * to any other row still steals focus and closes it, as it should.
 */
const holdRowFocus = (e: React.PointerEvent) => {
  if (e.pointerType === 'mouse') e.preventDefault()
}

const EDIT_ROW_CLASS = cn(
  chipVariants({ active: true, fullWidth: true }),
  'min-w-0 cursor-default select-none text-small'
)

/**
 * Radix's menu trigger swallows Enter to toggle the menu, which would leave a rail nav chip
 * with no keyboard route to its own page. The flyout opens on hover, so Enter belongs to the
 * link — and defaulting the event is what keeps Radix's composed handler from running.
 */
function activateLinkOnEnter(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  e.currentTarget.click()
}

/**
 * Hover-opened rail flyout. The component owns only the trigger and the menu —
 * the caller places it, so spacing stays with the surrounding list.
 */
export function CollapsedSidebarMenu({
  icon,
  hover,
  ariaLabel,
  children,
  primaryAction,
  navLink,
}: CollapsedSidebarMenuProps) {
  return (
    <DropdownMenu
      open={hover.isOpen}
      onOpenChange={(open) => {
        if (open) hover.open()
        else hover.close()
      }}
      modal={false}
    >
      <div {...hover.triggerProps}>
        <DropdownMenuTrigger asChild>
          {navLink ? (
            <SidebarNavChip
              item={navLink.item}
              active={navLink.active}
              onContextMenu={
                navLink.onContextMenu && navLink.item.href
                  ? (e) => navLink.onContextMenu?.(e, navLink.item.href as string)
                  : undefined
              }
              onKeyDown={activateLinkOnEnter}
            />
          ) : (
            <Chip
              aria-label={ariaLabel}
              /* `leftAdornment`, not children: a chip wraps children in its label span, which
                 would stretch the bare rail glyph across the pill. */
              leftAdornment={icon}
              fullWidth
              className={SIDEBAR_RAIL_CHIP_CLASS}
            />
          )}
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent side='right' align='start' sideOffset={8} {...hover.contentProps}>
        {primaryAction && (
          <>
            <DropdownMenuItem onSelect={primaryAction.onSelect}>
              <Plus className='size-[14px]' />
              {primaryAction.label}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CollapsedChatFlyoutItem({
  chat,
  isCurrentRoute,
  isMenuOpen = false,
  isEditing = false,
  editValue,
  inputRef,
  isRenaming = false,
  onEditValueChange,
  onEditKeyDown,
  onEditBlur,
  onContextMenu,
  onMorePointerDown,
  onMoreClick,
}: CollapsedChatFlyoutItemProps) {
  const showActions = chat.id !== 'new' && onMoreClick

  if (isEditing) {
    return (
      <div className={EDIT_ROW_CLASS}>
        <input
          aria-label={`Rename chat ${chat.name}`}
          ref={inputRef}
          value={editValue ?? chat.name}
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-small outline-hidden focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
          maxLength={100}
          disabled={isRenaming}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      </div>
    )
  }

  return (
    <DropdownMenuItem
      asChild
      active={isCurrentRoute || isMenuOpen}
      action={
        showActions ? (
          <DropdownMenuItemAction
            aria-label='Chat options'
            onPointerDown={onMorePointerDown}
            onClick={(e) => onMoreClick?.(e, chat.id)}
            className={cn(isMenuOpen && 'opacity-100')}
          >
            <MoreHorizontal />
          </DropdownMenuItemAction>
        ) : undefined
      }
    >
      <ChatNavigationLink
        chatId={chat.id}
        href={chat.href}
        isCurrentRoute={isCurrentRoute}
        onContextMenu={
          chat.id !== 'new' && onContextMenu ? (e) => onContextMenu(e, chat.id) : undefined
        }
      >
        <ConversationListItem
          title={chat.name}
          isActive={!!chat.isActive}
          isUnread={!!chat.isUnread && !isCurrentRoute}
        />
      </ChatNavigationLink>
    </DropdownMenuItem>
  )
}

export function CollapsedWorkflowFlyoutItem({
  workflow,
  href,
  isCurrentRoute = false,
  isEditing = false,
  editValue,
  inputRef,
  isRenaming = false,
  onEditValueChange,
  onEditKeyDown,
  onEditBlur,
  onOpenInNewTab,
  onRename,
  canRename = true,
}: CollapsedWorkflowFlyoutItemProps) {
  const hasActions = !!onOpenInNewTab || !!onRename
  const [actionsOpen, setActionsOpen] = useState(false)

  if (isEditing) {
    return (
      <div className={EDIT_ROW_CLASS}>
        <input
          aria-label={`Rename workflow ${workflow.name}`}
          ref={inputRef}
          value={editValue ?? workflow.name}
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-small outline-hidden focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
          maxLength={100}
          disabled={isRenaming}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      </div>
    )
  }

  return (
    <DropdownMenuItem
      asChild
      active={isCurrentRoute || actionsOpen}
      onPointerMove={actionsOpen ? holdRowFocus : undefined}
      onPointerLeave={actionsOpen ? holdRowFocus : undefined}
      action={
        hasActions ? (
          <DropdownMenuSub
            open={actionsOpen}
            onOpenChange={(open) => {
              if (!open) setActionsOpen(false)
            }}
          >
            <DropdownMenuSubTrigger asChild>
              <DropdownMenuItemAction
                aria-label='Workflow options'
                onClick={() => setActionsOpen((prev) => !prev)}
                className={cn(actionsOpen && 'opacity-100')}
              >
                <MoreHorizontal />
              </DropdownMenuItemAction>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {onOpenInNewTab && (
                <DropdownMenuItem onSelect={onOpenInNewTab}>
                  <SquareArrowUpRight className='size-[14px]' />
                  Open in new tab
                </DropdownMenuItem>
              )}
              {onRename && (
                <DropdownMenuItem
                  disabled={!canRename}
                  onSelect={(e) => {
                    e.preventDefault()
                    setActionsOpen(false)
                    onRename()
                  }}
                >
                  <Pencil className='size-[14px]' />
                  Rename
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : undefined
      }
    >
      <Link
        href={href}
        onContextMenu={
          hasActions
            ? (e) => {
                e.preventDefault()
                setActionsOpen(true)
              }
            : undefined
        }
      >
        <OverflowText label={workflow.name} className='flex-1' />
      </Link>
    </DropdownMenuItem>
  )
}

interface CollapsedFolderItemsProps {
  nodes: FolderTreeNode[]
  workflowsByFolder: Record<string, WorkflowMetadata[]>
  workspaceId: string
  currentWorkflowId?: string
  editingWorkflowId?: string | null
  editingValue?: string
  editInputRef?: React.RefObject<HTMLInputElement | null>
  isRenamingWorkflow?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onWorkflowOpenInNewTab?: (workflow: WorkflowMetadata) => void
  onWorkflowRename?: (workflow: WorkflowMetadata) => void
  canRenameWorkflow?: boolean
}

/**
 * Renders folder flyouts for one level of the collapsed sidebar. A folder's
 * submenu interleaves its child folders and workflows by `sortOrder` — the same
 * single ordering the expanded sidebar and this menu's own root level use, so a
 * folder never jumps above a workflow the user dragged above it.
 */
export function CollapsedFolderItems(props: CollapsedFolderItemsProps) {
  const {
    nodes,
    workflowsByFolder,
    workspaceId,
    currentWorkflowId,
    editingWorkflowId,
    editingValue,
    editInputRef,
    isRenamingWorkflow,
    onEditValueChange,
    onEditKeyDown,
    onEditBlur,
    onWorkflowOpenInNewTab,
    onWorkflowRename,
    canRenameWorkflow,
  } = props

  return (
    <>
      {nodes.map((folder) => {
        const folderWorkflows = workflowsByFolder[folder.id] || []
        const hasChildren = folder.children.length > 0 || folderWorkflows.length > 0

        if (!hasChildren) {
          return (
            <DropdownMenuItem key={folder.id} disabled>
              <OverflowText label={folder.name} />
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuSub key={folder.id}>
            <DropdownMenuSubTrigger>
              <OverflowText label={folder.name} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {interleaveSiblings(folder.children, folderWorkflows).map((child) =>
                child.kind === 'folder' ? (
                  <CollapsedFolderItems key={child.id} {...props} nodes={[child.node]} />
                ) : (
                  <CollapsedWorkflowFlyoutItem
                    key={child.id}
                    workflow={child.workflow}
                    href={`/workspace/${workspaceId}/w/${child.workflow.id}`}
                    isCurrentRoute={child.workflow.id === currentWorkflowId}
                    isEditing={child.workflow.id === editingWorkflowId}
                    editValue={editingValue}
                    inputRef={editInputRef}
                    isRenaming={isRenamingWorkflow}
                    onEditValueChange={onEditValueChange}
                    onEditKeyDown={onEditKeyDown}
                    onEditBlur={onEditBlur}
                    onOpenInNewTab={
                      onWorkflowOpenInNewTab
                        ? () => onWorkflowOpenInNewTab(child.workflow)
                        : undefined
                    }
                    onRename={onWorkflowRename ? () => onWorkflowRename(child.workflow) : undefined}
                    canRename={canRenameWorkflow}
                  />
                )
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}
