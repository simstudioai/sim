'use client'

import { chipVariants, cn, DropdownMenuItem, Loader, OverflowText, Skeleton } from '@sim/emcn'
import { MoreHorizontal, Pin, Task } from '@sim/emcn/icons'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'
import { useOrganizationChatActions } from '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-chat-actions'
import {
  ChatNavigationLink,
  CollapsedChatFlyoutItem,
  CollapsedSidebarMenu,
  SidebarSection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SidebarRenameRow } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-rename-row'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import {
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

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
  onContextMenu: (e: React.MouseEvent, chatId: string) => void
  onMorePointerDown: () => void
  onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, chatId: string) => void
}

function ChatRow({
  chat,
  isCurrentRoute,
  isMenuOpen,
  onContextMenu,
  onMorePointerDown,
  onMoreClick,
}: ChatRowProps) {
  /**
   * The trailing slot fits one glyph, and the dot wins over the pin: it reports
   * transient state (a run in progress, or an unread reply elsewhere), while pinning
   * is persistent and already conveyed by the row sorting to the top of the list.
   */
  const showStatusDot = Boolean(chat.isActive) || (!isCurrentRoute && Boolean(chat.isUnread))

  return (
    <ChatNavigationLink
      href={chat.href}
      chatId={chat.id}
      isCurrentRoute={isCurrentRoute}
      className={chipVariants({ active: isCurrentRoute || isMenuOpen, fullWidth: true })}
      onContextMenu={(e) => onContextMenu(e, chat.id)}
    >
      <OverflowText label={chat.name} className='flex-1 text-[var(--text-body)]' />
      <div className='relative flex size-[18px] shrink-0 items-center justify-center'>
        {showStatusDot && (
          <span
            aria-hidden='true'
            className={cn(
              'size-[6px] rounded-full transition-opacity',
              isMenuOpen ? 'opacity-0' : 'group-focus-within:opacity-0 group-hover:opacity-0'
            )}
            style={{ backgroundColor: chat.isActive ? '#EAB308' : 'var(--brand-accent)' }}
          />
        )}
        {!showStatusDot && chat.isPinned && (
          <Pin
            aria-hidden='true'
            className={cn(
              'absolute size-[12px] text-[var(--text-icon)] transition-opacity',
              isMenuOpen ? 'opacity-0' : 'group-focus-within:opacity-0 group-hover:opacity-0'
            )}
          />
        )}
        <button
          type='button'
          aria-label='Chat options'
          onPointerDown={onMorePointerDown}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMoreClick(e, chat.id)
          }}
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-sm opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
            isMenuOpen && 'opacity-100'
          )}
        >
          <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
        </button>
      </div>
    </ChatNavigationLink>
  )
}

interface ChatsSectionProps {
  organizationId: string
  chats: OrganizationChat[]
  isLoading: boolean
  isCollapsed: boolean
  pathname: string | null
}

export function ChatsSection({
  organizationId,
  chats,
  isLoading,
  isCollapsed,
  pathname,
}: ChatsSectionProps) {
  const actions = useOrganizationChatActions({ organizationId, chats })
  const { menu, hover, rename, selectedChat } = actions
  const menuOpenChatId = menu.isOpen ? selectedChat?.id : null
  const saveRename = () => {
    void rename.saveRename()
  }

  return (
    <>
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
              isEditing={rename.editingId !== null}
            >
              {isLoading ? (
                <DropdownMenuItem disabled>
                  <Loader className='size-[14px]' animate />
                  Loading...
                </DropdownMenuItem>
              ) : chats.length === 0 ? (
                <DropdownMenuItem disabled>No chats yet</DropdownMenuItem>
              ) : (
                chats.map((chat) => (
                  <CollapsedChatFlyoutItem
                    key={chat.id}
                    chat={chat}
                    isCurrentRoute={pathname === chat.href}
                    isMenuOpen={menuOpenChatId === chat.id}
                    isEditing={rename.editingId === chat.id}
                    editValue={rename.value}
                    inputRef={rename.inputRef}
                    isRenaming={rename.isSaving}
                    onEditValueChange={rename.setValue}
                    onEditKeyDown={rename.handleKeyDown}
                    onEditBlur={saveRename}
                    onContextMenu={actions.onContextMenu}
                    onMorePointerDown={actions.onMorePointerDown}
                    onMoreClick={actions.onMoreClick}
                  />
                ))
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
                {chats.map((chat) =>
                  rename.editingId === chat.id ? (
                    <SidebarRenameRow
                      key={chat.id}
                      ref={rename.inputRef}
                      aria-label={`Rename chat ${chat.name}`}
                      value={rename.value}
                      onChange={(event) => rename.setValue(event.target.value)}
                      onKeyDown={rename.handleKeyDown}
                      onBlur={saveRename}
                      disabled={rename.isSaving}
                    />
                  ) : (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      isCurrentRoute={pathname === chat.href}
                      isMenuOpen={menuOpenChatId === chat.id}
                      onContextMenu={actions.onContextMenu}
                      onMorePointerDown={actions.onMorePointerDown}
                      onMoreClick={actions.onMoreClick}
                    />
                  )
                )}
              </>
            )}
          </div>
        )}
      </SidebarSection>
      <ContextMenu
        isOpen={menu.isOpen}
        position={menu.position}
        menuRef={menu.menuRef}
        onClose={menu.closeMenu}
        onOpenInNewTab={actions.openInNewTab}
        onCopyLink={actions.copyLink}
        onRename={actions.startRename}
        renameInputRef={rename.inputRef}
        onTogglePin={actions.togglePin}
        onMarkAsRead={actions.markRead}
        onMarkAsUnread={actions.markUnread}
        showOpenInNewTab
        showRename={Boolean(selectedChat)}
        showPin={Boolean(selectedChat)}
        isPinned={Boolean(selectedChat?.isPinned)}
        showMarkAsRead={Boolean(selectedChat?.isUnread)}
        showMarkAsUnread={Boolean(selectedChat) && !selectedChat?.isUnread}
        onDelete={actions.startDelete}
        showDelete={Boolean(selectedChat)}
        showDuplicate={false}
      />
      <DeleteModal
        isOpen={actions.chatToDelete !== null}
        onClose={actions.cancelDelete}
        onConfirm={actions.confirmDelete}
        isDeleting={actions.isDeleting}
        itemType='task'
        itemName={actions.chatToDelete?.name}
      />
    </>
  )
}
