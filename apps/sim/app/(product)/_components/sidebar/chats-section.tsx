'use client'

import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu, ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { useSearchParams } from 'next/navigation'
import type { ShellActions, ShellChat } from '@/app/(product)/_components/model'
import { SidebarSortMenu } from '@/app/(product)/_components/sidebar/collection-order'
import { linkMenuActions, pinAction } from '@/app/(product)/_components/sidebar/row-links'
import { SectionStatus } from '@/app/(product)/_components/sidebar/section-status'
import styles from '@/app/(product)/_components/sidebar/sidebar-collections.module.css'
import { useSidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'
import { platformHref } from '@/platform/lib/navigation'
import { readFormText } from '@/platform/shared/row-links'
import type { ShellQueryStatus } from '@/platform/shared/shell'

const NO_SELECTION: ReadonlySet<string> = new Set()
const CHAT_TITLE_MAX_LENGTH = 200

function chatStatus(chat: ShellChat, isCurrent: boolean) {
  const status = chat.isActive ? 'Running' : chat.isUnread && !isCurrent ? 'Unread' : undefined
  if (chat.isPinned)
    return <Icon name='I131' label={status ? `Pinned, ${status.toLowerCase()}` : 'Pinned'} />
  if (status)
    return (
      <span
        className={styles.dot}
        role='img'
        aria-label={status}
        data-running={chat.isActive || undefined}
      />
    )
  return null
}

interface ChatsSectionProps {
  chats: readonly ShellChat[]
  status?: ShellQueryStatus
  activeChat?: string
  actions: ShellActions['chats']
  navigate: (href: string) => void
}

type ChatEdit = { kind: 'rename'; chatId: string } | { kind: 'remove'; chats: readonly ShellChat[] }

export function ChatsSection({ chats, status, activeChat, actions, navigate }: ChatsSectionProps) {
  const query = useSearchParams()
  const { chatsOpen, setChatsOpen, chatOrder, setChatOrder } = useSidebarLayout()
  const [editing, setEditing] = useState<ChatEdit | null>(null)
  const [selected, setSelected] = useState(NO_SELECTION)
  const selectionAnchor = useRef<string | null>(null)
  const cancelPrefetch = useRef<(() => void) | null>(null)
  const selectedChats = chats.filter((chat) => selected.has(chat.id))
  const isMultiSelecting = selectedChats.length > 1

  useEffect(() => {
    if (!isMultiSelecting) return
    function clearOnBackgroundClick(event: globalThis.MouseEvent) {
      if (event.target instanceof Element && event.target.closest('a, button, [role=menu], dialog'))
        return
      setSelected(NO_SELECTION)
    }
    document.addEventListener('click', clearOnBackgroundClick)
    return () => document.removeEventListener('click', clearOnBackgroundClick)
  }, [isMultiSelecting])

  function selectOnly(id: string) {
    selectionAnchor.current = id
    setSelected(new Set([id]))
  }

  function extendSelection(id: string) {
    const anchor = selectionAnchor.current
    const ids = chats.map((chat) => chat.id)
    if (!anchor || !ids.includes(anchor)) {
      selectOnly(id)
      return
    }
    if (anchor === id) {
      setSelected((previous) => {
        const next = new Set(previous)
        if (!next.delete(id)) next.add(id)
        return next
      })
      return
    }
    const [start, end] = [ids.indexOf(anchor), ids.indexOf(id)].sort((a, b) => a - b)
    setSelected(new Set(ids.slice(start, end + 1)))
  }

  /** Selection is the row's job on a shift click, which `next/link` would treat as a new window. */
  function selectOnShiftClick(event: MouseEvent, id: string) {
    if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.target instanceof Element && event.target.closest('button')) return
    event.preventDefault()
    event.stopPropagation()
    extendSelection(id)
  }

  function rowActions(chat: ShellChat): MenuAction[] {
    if (isMultiSelecting && selected.has(chat.id))
      return [
        {
          id: 'remove',
          destructive: true,
          label: `${actions.removeLabel} ${selectedChats.length} chats`,
          icon: 'I061',
          onSelect: () => setEditing({ kind: 'remove', chats: selectedChats }),
        },
      ]
    const { setPinned, setRead } = actions
    return [
      ...(chat.href ? linkMenuActions(chat.href) : []),
      {
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        onSelect: () => setEditing({ kind: 'rename', chatId: chat.id }),
      },
      pinAction(chat, setPinned),
      ...(setRead
        ? [
            {
              id: 'read',
              label: chat.isUnread ? 'Mark as read' : 'Mark as unread',
              icon: chat.isUnread ? 'I072' : 'I106',
              onSelect: () => setRead(chat.id, Boolean(chat.isUnread)),
            } satisfies MenuAction,
          ]
        : []),
      {
        id: 'remove',
        destructive: true,
        label: actions.removeLabel,
        icon: 'I061',
        separatorBefore: true,
        onSelect: () => setEditing({ kind: 'remove', chats: [chat] }),
      },
    ]
  }

  /** A removal that only partly lands narrows the dialog to what is left and reports the rest. */
  async function confirmRemoval(targets: readonly ShellChat[]) {
    const { removedIds, failure } = await actions.remove(targets.map((chat) => chat.id))
    if (activeChat && removedIds.includes(activeChat)) navigate('/home')
    if (!failure) {
      setSelected(NO_SELECTION)
      return
    }
    setEditing({
      kind: 'remove',
      chats: targets.filter((chat) => !removedIds.includes(chat.id)),
    })
    throw new Error(failure)
  }

  const renamingChat =
    editing?.kind === 'rename' ? chats.find((chat) => chat.id === editing.chatId) : undefined
  const removing = editing?.kind === 'remove' ? editing.chats : []
  const removeTitle =
    removing.length > 1
      ? `${actions.removeLabel} ${removing.length} chats`
      : `${actions.removeLabel} chat`

  return (
    <>
      <Disclosure
        variant='navigation'
        label='Chats'
        open={chatsOpen}
        onOpenChange={setChatsOpen}
        actions={<SidebarSortMenu section='chats' order={chatOrder} onChange={setChatOrder} />}
      >
        <div className={styles.group}>
          <SectionStatus
            status={status}
            isEmpty={chats.length === 0}
            emptyLabel='No chats yet'
            failureLabel='Could not load chats'
            onRetry={actions.retry}
          />
          {chats.map((item) => {
            const href = item.href ?? `/chat/${item.id}`
            const rows = rowActions(item)
            const isCurrent = activeChat === item.id
            const selectOnMenuOpen = (open: boolean) => {
              if (open && !selected.has(item.id)) selectOnly(item.id)
            }
            return (
              <ContextActionMenu
                key={item.id}
                label={`Actions for ${item.title}`}
                actions={rows}
                onOpenChange={selectOnMenuOpen}
              >
                <div
                  className={styles.row}
                  data-selected={(isMultiSelecting && selected.has(item.id)) || undefined}
                  onClickCapture={(event) => selectOnShiftClick(event, item.id)}
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest('a'))
                      selectOnly(item.id)
                  }}
                  onPointerEnter={() => {
                    if (!isCurrent) cancelPrefetch.current = actions.prefetch?.(item) ?? null
                  }}
                  onPointerLeave={() => cancelPrefetch.current?.()}
                >
                  <Chip
                    href={platformHref(href, query)}
                    selected={isCurrent}
                    status={chatStatus(item, isCurrent)}
                    replaceActionOnTouch={item.isPinned}
                    action={
                      <ActionMenu
                        label={`Actions for ${item.title}`}
                        tooltip={false}
                        icon='I108'
                        triggerSize='compact'
                        align='end'
                        actions={rows}
                        onOpenChange={selectOnMenuOpen}
                      />
                    }
                  >
                    {item.title}
                  </Chip>
                </div>
              </ContextActionMenu>
            )
          })}
        </div>
      </Disclosure>
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
            placeholder='Chat name'
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
          title={removeTitle}
          confirmLabel={actions.removeLabel}
          destructive
          onConfirm={() => confirmRemoval(removing)}
        >
          <p data-type='T048'>
            {removing.length === 1
              ? `${actions.removeLabel} “${removing[0].title}”?`
              : `${actions.removeLabel} ${removing.length} chats?`}
            {actions.removeDetail && ` ${actions.removeDetail(removing.length)}`}
          </p>
        </Modal>
      )}
    </>
  )
}
