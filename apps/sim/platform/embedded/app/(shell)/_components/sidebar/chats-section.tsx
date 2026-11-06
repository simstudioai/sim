'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { usePathname, useRouter } from 'next/navigation'
import { isPathOrDescendant, organizationRoutes } from '@/lib/navigation/paths'
import { ChatNavigationLink } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/chat-navigation-link/chat-navigation-link'
import { useChatSelection } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-chat-selection'
import { Disclosure } from '@/platform/design-system/components/disclosure/disclosure'
import { ActionMenu, type MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { ConfirmDialog } from '@/platform/design-system/components/modal/confirm-dialog'
import { NameModal } from '@/platform/embedded/app/(shell)/_components/sidebar/name-modal'
import { RailFlyout } from '@/platform/embedded/app/(shell)/_components/sidebar/rail-flyout'
import {
  PinnedIndicator,
  SectionRow,
} from '@/platform/embedded/app/(shell)/_components/sidebar/section-row'
import { SectionStatus } from '@/platform/embedded/app/(shell)/_components/sidebar/section-status'
import styles from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import { useChatListActions } from '@/platform/embedded/lib/data/chat-list'
import type { ShellChat, ShellQueryStatus } from '@/platform/embedded/lib/data/shell-view'
import { copyLinkAction, openInNewTabAction } from '@/platform/embedded/lib/row-links'
import { useFolderStore } from '@/stores/folders/store'

const CHAT_TITLE_MAX_LENGTH = 200

const CHAT_ORDERS = ['Recent activity', 'Name (A–Z)', 'Name (Z–A)'] as const
type ChatOrder = (typeof CHAT_ORDERS)[number]

function sortChats(chats: readonly ShellChat[], order: ChatOrder): readonly ShellChat[] {
  if (order === 'Recent activity') return chats
  const direction = order === 'Name (A–Z)' ? 1 : -1
  return [...chats].sort(
    (a, b) => Number(b.isPinned) - Number(a.isPinned) || direction * a.title.localeCompare(b.title)
  )
}

/** The slot fits one glyph. A dot reports what changed; a pin is already told by the row's place. */
function chatStatus(chat: ShellChat, isCurrent: boolean) {
  if (chat.isActive)
    return (
      <span className={styles.indicator} role='img' aria-label='Running'>
        <span className={styles.dot} data-running='' />
      </span>
    )
  if (chat.isUnread && !isCurrent)
    return (
      <span className={styles.indicator} role='img' aria-label='Unread'>
        <span className={styles.dot} />
      </span>
    )
  return chat.isPinned ? <PinnedIndicator /> : null
}

type ChatEdit = { kind: 'rename'; chatId: string } | { kind: 'remove'; chatIds: readonly string[] }

interface ChatsSectionProps {
  organizationId: string
  chats: readonly ShellChat[]
  status: ShellQueryStatus
  onRetry: () => void
  collapsed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatsSection({
  organizationId,
  chats,
  status,
  onRetry,
  collapsed,
  open,
  onOpenChange,
}: ChatsSectionProps) {
  const pathname = usePathname()
  const router = useRouter()
  const actions = useChatListActions(organizationId)
  const [editing, setEditing] = useState<ChatEdit | null>(null)
  const [order, setOrder] = useState<ChatOrder>('Recent activity')
  const ordered = sortChats(chats, order)
  const { selectedChats, handleChatClick } = useChatSelection({
    chatIds: ordered.map((chat) => chat.id),
  })
  const isMultiSelecting = selectedChats.size > 1

  function rowActions(chat: ShellChat): MenuAction[] {
    if (isMultiSelecting && selectedChats.has(chat.id)) {
      const targets = ordered.filter((row) => selectedChats.has(row.id))
      return [
        {
          id: 'remove',
          destructive: true,
          label: `Delete ${targets.length} chats`,
          icon: 'I061',
          onSelect: () => setEditing({ kind: 'remove', chatIds: targets.map((row) => row.id) }),
        },
      ]
    }
    return [
      openInNewTabAction(chat.href),
      copyLinkAction(chat.href),
      {
        id: 'read',
        label: chat.isUnread ? 'Mark as read' : 'Mark as unread',
        icon: chat.isUnread ? 'I072' : 'I106',
        onSelect: () => actions.setRead(chat.id, chat.isUnread),
      },
      {
        id: 'pin',
        label: chat.isPinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => actions.setPinned(chat.id, !chat.isPinned),
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        onSelect: () => setEditing({ kind: 'rename', chatId: chat.id }),
      },
      {
        id: 'remove',
        destructive: true,
        label: 'Delete',
        icon: 'I061',
        separatorBefore: true,
        onSelect: () => setEditing({ kind: 'remove', chatIds: [chat.id] }),
      },
    ]
  }

  /** Leaving the open chat returns to where its mode lives: Search for assistant, Home for agent. */
  function leaveIfRemoved(removed: readonly ShellChat[]) {
    const current = removed.find((chat) => window.location.pathname === chat.href)
    if (!current) return
    const routes = organizationRoutes(organizationId)
    router.push(isPathOrDescendant(current.href, routes.search) ? routes.search : routes.home)
  }

  /** A removal that only partly lands narrows the dialog to what is left and reports why. */
  async function confirmRemoval(targets: readonly ShellChat[]) {
    const { removedIds, failure } = await actions.remove(targets.map((chat) => chat.id))
    leaveIfRemoved(targets.filter((chat) => removedIds.includes(chat.id)))
    if (!failure) {
      useFolderStore.getState().clearChatSelection()
      return true
    }
    toast.error(failure)
    setEditing({
      kind: 'remove',
      chatIds: targets.map((chat) => chat.id).filter((id) => !removedIds.includes(id)),
    })
    return false
  }

  function renderRows(hold?: (held: boolean) => void) {
    return (
      <div className={styles.group}>
        <SectionStatus
          status={status}
          isEmpty={chats.length === 0}
          emptyLabel='No chats yet'
          failureLabel='Could not load chats'
          onRetry={onRetry}
        />
        {ordered.map((chat) => {
          const isCurrent = pathname === chat.href
          return (
            <SectionRow
              key={chat.id}
              label={chat.title}
              actions={() => rowActions(chat)}
              selected={isMultiSelecting && selectedChats.has(chat.id)}
              status={chatStatus(chat, isCurrent)}
              onMenuOpenChange={(menuOpen) => {
                if (menuOpen && !selectedChats.has(chat.id))
                  useFolderStore.getState().selectChatOnly(chat.id)
                hold?.(menuOpen)
              }}
              render={
                <ChatNavigationLink
                  href={chat.href}
                  chatId={chat.id}
                  isCurrentRoute={isCurrent}
                  onSelectChat={handleChatClick}
                  aria-current={isCurrent ? 'page' : undefined}
                />
              }
            />
          )
        })}
      </div>
    )
  }

  const renamingChat =
    editing?.kind === 'rename' ? chats.find((chat) => chat.id === editing.chatId) : undefined
  const removing =
    editing?.kind === 'remove' ? chats.filter((chat) => editing.chatIds.includes(chat.id)) : []

  return (
    <>
      {collapsed ? (
        <RailFlyout label='Chats' icon='I073'>
          {renderRows}
        </RailFlyout>
      ) : (
        <Disclosure
          variant='section'
          label='Chats'
          open={open}
          onOpenChange={onOpenChange}
          actions={
            <ActionMenu
              label='Sort chats'
              triggerSize='compact'
              icon='I050'
              actions={CHAT_ORDERS.map((label) => ({
                id: label,
                label,
                checked: label === order,
                onSelect: () => setOrder(label),
              }))}
            />
          }
        >
          {open && renderRows()}
        </Disclosure>
      )}
      {renamingChat && (
        <NameModal
          title='Rename chat'
          confirmLabel='Save'
          fieldLabel='Chat name'
          emptyMessage='Enter a chat name.'
          maxLength={CHAT_TITLE_MAX_LENGTH}
          initial={renamingChat.title}
          onSubmit={(name) => actions.rename(renamingChat.id, name)}
          onClose={() => setEditing(null)}
        />
      )}
      {removing.length > 0 && (
        <ConfirmDialog
          target
          onClose={() => setEditing(null)}
          title={removing.length > 1 ? `Delete ${removing.length} chats` : 'Delete chat'}
          confirmLabel='Delete'
          pendingLabel='Deleting…'
          onConfirm={() => confirmRemoval(removing)}
        >
          <p data-type='T048'>
            {removing.length === 1
              ? `Delete “${removing[0].title}”?`
              : `Delete ${removing.length} chats?`}{' '}
            You can restore {removing.length === 1 ? 'it' : 'them'} from Recently deleted in
            Settings.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
