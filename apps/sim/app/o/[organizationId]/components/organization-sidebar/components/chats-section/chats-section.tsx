'use client'

import { chipVariants, cn, DropdownMenuItem, Loader, OverflowText, Skeleton } from '@sim/emcn'
import { MoreHorizontal, Pin, Task } from '@sim/emcn/icons'
import Link from 'next/link'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import {
  CollapsedSidebarMenu,
  SidebarSection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

/** Stands in for a chip row while the list loads, so it carries no margin either. */
function ChatRowSkeleton() {
  return (
    <div className='sidebar-collapse-hide flex h-[30px] items-center gap-2 rounded-lg px-2'>
      <Skeleton className='size-[16px] shrink-0 rounded-sm' />
    </div>
  )
}

interface ChatRowProps {
  chat: OrganizationChat
  isCurrentRoute: boolean
  isMenuOpen: boolean
  onContextMenu: (e: React.MouseEvent, href: string) => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, href: string) => void
}

function ChatRow({ chat, isCurrentRoute, isMenuOpen, onContextMenu, onMoreClick }: ChatRowProps) {
  /**
   * The trailing slot fits one glyph, and the dot wins over the pin: it reports
   * transient state (a run in progress, or an unread reply elsewhere), while pinning
   * is persistent and already conveyed by the row sorting to the top of the list.
   */
  const showStatusDot = Boolean(chat.isActive) || (!isCurrentRoute && Boolean(chat.isUnread))

  return (
    <Link
      href={chat.href}
      className={chipVariants({ active: isCurrentRoute || isMenuOpen, fullWidth: true })}
      onContextMenu={(e) => onContextMenu(e, chat.href)}
    >
      <OverflowText label={chat.name} className='flex-1 text-[var(--text-body)]' />
      <div className='relative flex size-[18px] shrink-0 items-center justify-center'>
        {showStatusDot && (
          <span
            aria-hidden='true'
            className={cn(
              'size-[6px] rounded-full transition-opacity',
              isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0'
            )}
            style={{ backgroundColor: chat.isActive ? '#EAB308' : 'var(--brand-accent)' }}
          />
        )}
        {!showStatusDot && chat.isPinned && (
          <Pin
            aria-hidden='true'
            className={cn(
              'absolute size-[12px] text-[var(--text-icon)] transition-opacity',
              isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0'
            )}
          />
        )}
        <button
          type='button'
          aria-label='Chat options'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMoreClick(e, chat.href)
          }}
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100',
            isMenuOpen && 'opacity-100'
          )}
        >
          <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
        </button>
      </div>
    </Link>
  )
}

interface ChatsSectionProps {
  chats: OrganizationChat[]
  isLoading: boolean
  isCollapsed: boolean
  pathname: string | null
  /** Href of the row whose options menu is open, so it stays highlighted meanwhile. */
  menuOpenHref: string | null
  onContextMenu: (e: React.MouseEvent, href: string) => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, href: string) => void
}

/**
 * The organization's chats, the section beneath Workspaces, spaced from it by the
 * section gap exactly as the workspace sidebar spaces its own sections. Expanded, a
 * collapsible list of every chat — no paging, the scroll region carries the length;
 * collapsed, a hover flyout off the rail glyph.
 */
export function ChatsSection({
  chats,
  isLoading,
  isCollapsed,
  pathname,
  menuOpenHref,
  onContextMenu,
  onMoreClick,
}: ChatsSectionProps) {
  const hover = useHoverMenu()

  return (
    <SidebarSection
      title='Chats'
      railCollapsed={isCollapsed}
      className={cn(SIDEBAR_SECTION_GAP_CLASS, 'chats-section shrink-0')}
    >
      {isCollapsed ? (
        <div className='px-2'>
          <CollapsedSidebarMenu
            icon={<Task className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
            hover={hover}
            ariaLabel='Chats'
          >
            {isLoading ? (
              <DropdownMenuItem disabled>
                <Loader className='size-[14px]' animate />
                Loading...
              </DropdownMenuItem>
            ) : chats.length === 0 ? (
              <DropdownMenuItem disabled>No chats yet</DropdownMenuItem>
            ) : (
              chats.map((chat) => {
                const isCurrentRoute = pathname === chat.href
                return (
                  <DropdownMenuItem key={chat.id} asChild active={isCurrentRoute}>
                    <Link href={chat.href} onContextMenu={(e) => onContextMenu(e, chat.href)}>
                      <ConversationListItem
                        title={chat.name}
                        isActive={Boolean(chat.isActive)}
                        isUnread={Boolean(chat.isUnread) && !isCurrentRoute}
                      />
                    </Link>
                  </DropdownMenuItem>
                )
              })
            )}
          </CollapsedSidebarMenu>
        </div>
      ) : (
        <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
          {isLoading ? (
            <ChatRowSkeleton />
          ) : (
            <>
              {chats.length === 0 && (
                <div className='flex h-[30px] items-center px-2 text-[var(--text-muted)] text-small'>
                  No chats yet
                </div>
              )}
              {chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  isCurrentRoute={pathname === chat.href}
                  isMenuOpen={menuOpenHref === chat.href}
                  onContextMenu={onContextMenu}
                  onMoreClick={onMoreClick}
                />
              ))}
            </>
          )}
        </div>
      )}
    </SidebarSection>
  )
}
