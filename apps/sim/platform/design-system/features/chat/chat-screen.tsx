'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Disclosure, IconButton, Tooltip } from '@/platform/design-system/components'
import { useChatChanges } from '@/platform/design-system/components/chat-changes'
import { MessageAttachments } from '@/platform/design-system/components/message-attachments'
import { MessageComposer } from '@/platform/design-system/components/message-composer'
import { userTurn } from '@/platform/design-system/components/user-turn'
import styles from '@/platform/design-system/features/chat/chat.module.css'
import { ChatPanelTrigger } from '@/platform/design-system/features/chat/panels/chat-panels'
import { CopyAction, ResponseTurn } from '@/platform/design-system/features/chat/response-turn'
import type { ChatTurn, ConversationData } from '@/platform/design-system/models/conversation'
import { platformHref } from '@/platform/design-system/navigation'

interface ChatScreenProps {
  data: ConversationData | null
  chatId?: string
}
export function ChatScreen({ data, chatId }: ChatScreenProps) {
  const changes = useChatChanges()
  const router = useRouter()
  const search = useSearchParams()
  const viewport = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [earlier, setEarlier] = useState(false)
  const thread = data?.threads.find((item) => item.id === chatId)
  const id = chatId ?? ''
  const title = changes.titleFor(id, thread?.title ?? 'New chat')
  const removed = changes.isRemoved(id)
  const turns = removed ? [] : (changes.turnsFor(id) ?? thread?.turns ?? [])
  const last = turns.at(-1)
  function transition(turn: ChatTurn, state: 'running' | 'stopped') {
    if (!turn.response) return
    changes.setTurnsFor(
      id,
      turns.map((item) =>
        item.id === turn.id && item.response
          ? { ...item, response: { ...item.response, state } }
          : item
      )
    )
  }
  useLayoutEffect(() => {
    const el = viewport.current
    if (el) el.scrollTop = el.scrollHeight
  }, [id, last?.id])
  return (
    <div className={styles.chat}>
      <header className={styles.header} data-overlap={scrolled || undefined}>
        <h1 data-type='T039'>{title}</h1>
        <ChatPanelTrigger />
      </header>
      <div
        className={styles.reading}
        ref={viewport}
        onScroll={(event) => {
          const el = event.currentTarget
          setScrolled(el.scrollTop > 0)
          setEarlier(el.scrollHeight - el.clientHeight - el.scrollTop > 32)
        }}
      >
        <div className={styles.thread}>
          {turns.map((turn) => (
            <article key={turn.id} className={styles.turn}>
              <UserMessage turn={turn} />
              {turn.response && (
                <ResponseTurn
                  response={turn.response}
                  onRetry={() => transition(turn, 'running')}
                />
              )}
            </article>
          ))}
        </div>
      </div>
      <div className={styles.dock}>
        {earlier && (
          <div className={styles.jump}>
            <Tooltip label='Jump to latest'>
              <IconButton
                variant='floating'
                icon='I102'
                label='Jump to latest'
                onClick={() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight })}
              />
            </Tooltip>
          </div>
        )}
        <div className={styles.dockInner}>
          <MessageComposer
            key={id}
            placeholder={
              last?.response?.state === 'running'
                ? 'Add a follow-up…'
                : turns.length
                  ? 'Ask a follow-up…'
                  : 'Ask about your business, or give Sim something to do…'
            }
            initialAttachments={data?.draftAttachments}
            references={data?.references}
            onStop={
              last?.response?.state === 'running' ? () => transition(last, 'stopped') : undefined
            }
            onSubmit={(draft) => {
              const next = userTurn(draft)
              if (id && !removed) {
                changes.setTurnsFor(id, [...turns, next])
                return
              }
              const newId = changes.createChat(
                draft.text.slice(0, 70) || draft.attachments[0]?.name || 'New chat',
                [next]
              )
              router.replace(platformHref(`/chat/${newId}`, search))
            }}
          />
        </div>
      </div>
    </div>
  )
}

interface UserMessageProps {
  turn: ChatTurn
}
function UserMessage({ turn }: UserMessageProps) {
  const text = turn.prompt.text
  const cut = text.length > 600 ? text.lastIndexOf(' ', 500) : -1
  return (
    <div className={styles.user}>
      <MessageAttachments items={turn.prompt.attachments} />
      {turn.prompt.text && (
        <div className={styles.bubble}>
          <p data-type='T048'>{cut < 0 ? text : text.slice(0, cut)}</p>
          {cut >= 0 && (
            <Disclosure label='Show more' expandedLabel='Show less' variant='more'>
              <p data-type='T048'>{text.slice(cut + 1)}</p>
            </Disclosure>
          )}
        </div>
      )}
      <div className={styles.userActions}>
        <time data-type='T052'>{turn.time}</time>
        <CopyAction label='Copy message' text={turn.prompt.text} />
      </div>
    </div>
  )
}
