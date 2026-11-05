'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { usePathname, useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { ChatNavigationLink } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/chat-navigation-link/chat-navigation-link'
import { useChatSelection } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-chat-selection'
import type {
  ShellChat,
  ShellChatActions,
  ShellData,
} from '@/platform/app/(shell)/_components/model'
import { RailFlyout } from '@/platform/app/(shell)/_components/sidebar/rail-flyout'
import {
  copyLinkAction,
  openInNewTabAction,
  readFormText,
} from '@/platform/app/(shell)/_components/sidebar/row-links'
import { SectionStatus } from '@/platform/app/(shell)/_components/sidebar/section-status'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import {
  ActionMenu,
  ContextActionMenu,
  Disclosure,
  Icon,
  Modal,
  TextField,
} from '@/platform/design-system/components'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { useFolderStore } from '@/stores/folders/store'

const CHAT_TITLE_MAX_LENGTH = 200

const CHAT_ORDERS = ['Recent activity', 'Name (A–Z)', 'Name (Z–A)'] as const
type ChatOrder = (typeof CHAT_ORDERS)[number]

function sortChats(chats: readonly ShellChat[], order: ChatOrder): readonly ShellChat[] {
  if (order === 'Recent activity') return chats
  const direction = order === 'Name (A–Z)' ? 1 : -1
  return [...chats].sort(
    (a, b) =>
      Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) ||
      direction * a.title.localeCompare(b.title)
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
  if (chat.isPinned)
    return (
      <span className={styles.indicator} role='img' aria-label='Pinned'>
        <Icon name='I131' />
      </span>
    )
  return null
}

type ChatEdit = { kind: 'rename'; chatId: string } | { kind: 'remove'; chats: readonly ShellChat[] }

interface ChatsSectionProps {
  organizationId: string
  chats: readonly ShellChat[]
  status: ShellData['status']['chats']
  actions: ShellChatActions
  collapsed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatsSection({
  organizationId,
  chats,
  status,
  actions,
  collapsed,
  open,
  onOpenChange,
}: ChatsSectionProps) {
  const pathname = usePathname()
  const router = useRouter()
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
          onSelect: () => setEditing({ kind: 'remove', chats: targets }),
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
        onSelect: () => actions.setRead(chat.id, Boolean(chat.isUnread)),
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
        onSelect: () => setEditing({ kind: 'remove', chats: [chat] }),
      },
    ]
  }

  /** Leaving the open chat returns to where its mode lives: Search for assistant, Home for agent. */
  function leaveIfRemoved(removed: readonly ShellChat[]) {
    const current = removed.find((chat) => window.location.pathname === chat.href)
    if (!current) return
    const routes = organizationRoutes(organizationId)
    router.push(current.href.startsWith(`${routes.search}/`) ? routes.search : routes.home)
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
    setEditing({ kind: 'remove', chats: targets.filter((chat) => !removedIds.includes(chat.id)) })
    return false
  }

  function selectBeforeMenu(chat: ShellChat, menuOpen: boolean) {
    if (menuOpen && !selectedChats.has(chat.id)) useFolderStore.getState().selectChatOnly(chat.id)
  }

  function renderRows(hold?: (held: boolean) => void) {
    return (
      <div className={styles.group}>
        <SectionStatus
          status={status}
          isEmpty={chats.length === 0}
          emptyLabel='No chats yet'
          failureLabel='Could not load chats'
          onRetry={actions.retry}
        />
        {ordered.map((chat) => {
          const rows = rowActions(chat)
          const isCurrent = pathname === chat.href
          const onMenuOpenChange = (menuOpen: boolean) => {
            selectBeforeMenu(chat, menuOpen)
            hold?.(menuOpen)
          }
          return (
            <ContextActionMenu
              key={chat.id}
              label={`Actions for ${chat.title}`}
              actions={rows}
              onOpenChange={onMenuOpenChange}
            >
              <div
                className={styles.row}
                data-selected={(isMultiSelecting && selectedChats.has(chat.id)) || undefined}
              >
                <ControlRow
                  label={chat.title}
                  status={chatStatus(chat, isCurrent)}
                  action={
                    <ActionMenu
                      label={`Actions for ${chat.title}`}
                      tooltip={false}
                      icon='I108'
                      triggerSize='compact'
                      align='end'
                      actions={rows}
                      onOpenChange={onMenuOpenChange}
                    />
                  }
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
              </div>
            </ContextActionMenu>
          )
        })}
      </div>
    )
  }

  const renamingChat =
    editing?.kind === 'rename' ? chats.find((chat) => chat.id === editing.chatId) : undefined
  const removing = editing?.kind === 'remove' ? editing.chats : []

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
          {renderRows()}
        </Disclosure>
      )}
      {renamingChat && (
        <Modal
          open
          onOpenChange={() => setEditing(null)}
          title='Rename chat'
          confirmLabel='Save'
          onConfirm={async (values) => {
            const next = readFormText(values, 'title')
            if (!next) throw new Error('Enter a chat name.')
            if (next !== renamingChat.title) await actions.rename(renamingChat.id, next)
          }}
        >
          <TextField
            label='Chat name'
            name='title'
            required
            maxLength={CHAT_TITLE_MAX_LENGTH}
            defaultValue={renamingChat.title}
          />
        </Modal>
      )}
      {editing?.kind === 'remove' && (
        <Modal
          open
          onOpenChange={() => setEditing(null)}
          variant='confirm'
          title={removing.length > 1 ? `Delete ${removing.length} chats` : 'Delete chat'}
          confirmLabel='Delete'
          destructive
          onConfirm={() => confirmRemoval(removing)}
        >
          <p data-type='T048'>
            {removing.length === 1
              ? `Delete “${removing[0].title}”?`
              : `Delete ${removing.length} chats?`}{' '}
            You can restore {removing.length === 1 ? 'it' : 'them'} from Recently deleted in
            Settings.
          </p>
        </Modal>
      )}
    </>
  )
}
