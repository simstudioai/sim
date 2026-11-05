'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MessageComposer } from '@/platform/app/(shell)/_components/composer/message-composer'
import type { ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import { userTurn } from '@/platform/app/(shell)/_components/composer/user-turn'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import styles from '@/platform/app/(shell)/chat/_components/conversation/conversation.module.css'
import type { ConversationData } from '@/platform/app/(shell)/chat/_components/conversation/model'
import { ResponseMessage } from '@/platform/app/(shell)/chat/_components/message/response-message'
import { UserMessage } from '@/platform/app/(shell)/chat/_components/message/user-message'
import { ChatPanelTrigger } from '@/platform/app/(shell)/chat/_components/panel/chat-panels'
import { IconButton, OverflowText, Tooltip } from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { platformHref } from '@/platform/design-system/navigation'

interface ConversationProps {
  data: ConversationData | null
  chatId?: string
}
export function Conversation({ data, chatId }: ConversationProps) {
  const changes = useChatChanges()
  const router = useRouter()
  const search = useSearchParams()
  const viewport = useRef<HTMLDivElement>(null)
  const reading = useScrollEdges('vertical', { viewport, tabStop: true })
  const [earlier, setEarlier] = useState(false)
  const thread = data?.threads.find((item) => item.id === chatId)
  const id = chatId ?? ''
  const title = changes.titleFor(id, thread?.title ?? 'New chat')
  const removed = changes.isRemoved(id)
  const turns = removed ? [] : (changes.turnsFor(id) ?? thread?.turns ?? [])
  const last = turns.at(-1)
  const running = turns.find((turn) => turn.response?.state === 'running')
  function transition(turn: ChatTurn, state: 'running' | 'stopped') {
    if (!turn.response) return
    const response =
      state === 'running'
        ? {
            ...turn.response,
            state,
            duration: '',
            steps: [],
            thinking: undefined,
            failure: undefined,
          }
        : { ...turn.response, state }
    changes.setTurnsFor(
      id,
      turns.map((item) => (item.id === turn.id ? { ...item, response } : item))
    )
  }
  useLayoutEffect(() => {
    const el = viewport.current
    if (el) el.scrollTop = el.scrollHeight
  }, [id, last?.id])
  return (
    <div className={styles.chat}>
      <header className={styles.header} data-desktop-drag=''>
        <h1 data-type='T039'>
          <OverflowText text={title}>{title}</OverflowText>
        </h1>
        <ChatPanelTrigger />
      </header>
      <div
        className={styles.reading}
        role='region'
        aria-label='Conversation'
        ref={reading}
        onScroll={(event) => {
          const el = event.currentTarget
          setEarlier(el.scrollHeight - el.clientHeight - el.scrollTop > 32)
        }}
      >
        <div className={styles.thread}>
          {turns.map((turn) => (
            <article key={turn.id} className={styles.turn}>
              <UserMessage turn={turn} />
              {turn.response && (
                <ResponseMessage
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
            draftKey={`chat/${id}`}
            placeholder={
              running
                ? 'Add a follow-up…'
                : turns.length
                  ? 'Ask a follow-up…'
                  : 'Ask about your business, or give Sim something to do…'
            }
            initialAttachments={!id || thread ? data?.draftAttachments : undefined}
            references={data?.references}
            onStop={running ? () => transition(running, 'stopped') : undefined}
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
