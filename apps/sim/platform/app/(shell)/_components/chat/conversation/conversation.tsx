'use client'

import { memo, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import styles from '@/platform/app/(shell)/_components/chat/conversation/conversation.module.css'
import { QueuedMessages } from '@/platform/app/(shell)/_components/chat/conversation/queued-messages'
import { ResponseMessage } from '@/platform/app/(shell)/_components/chat/message/response-message'
import { UserMessage } from '@/platform/app/(shell)/_components/chat/message/user-message'
import type { ChatRuntime, PlatformTurn } from '@/platform/app/(shell)/_components/chat/model'
import { ChatPanelTrigger } from '@/platform/app/(shell)/_components/chat/panel/chat-panels'
import { MessageComposer } from '@/platform/app/(shell)/_components/composer/message-composer'
import type { ComposerController } from '@/platform/app/(shell)/_components/composer/model'
import { ChatRuntimeProvider } from '@/platform/app/(shell)/_components/session/chat-runtime'
import {
  Button,
  IconButton,
  InlineNotice,
  OverflowText,
  Tooltip,
} from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

/** A settled turn keeps its identity, so only the streaming one renders per chunk. */
const Turn = memo(function Turn({ turn }: { turn: PlatformTurn }) {
  if (turn.role === 'user') return <UserMessage turn={turn} />
  if (turn.role === 'automated')
    return (
      <p className={styles.automated} data-type='T052'>
        <strong>{turn.label}</strong> {turn.summary}
      </p>
    )
  return <ResponseMessage turn={turn} />
})

/** One exchange per article: a person's message and what answered it. */
function groupExchanges(turns: readonly PlatformTurn[]): PlatformTurn[][] {
  const exchanges: PlatformTurn[][] = []
  for (const turn of turns) {
    const current = exchanges.at(-1)
    if (current && turn.role === 'assistant') current.push(turn)
    else exchanges.push([turn])
  }
  return exchanges
}

/** Scrolling up by more than this stops following the stream. */
const FOLLOW_SLACK = 32

interface ConversationProps {
  runtime: ChatRuntime
  composer: ComposerController
  placeholders: { first: string; followUp: string; running: string }
  /** Replaces the title, for a surface with its own header controls. */
  header?: ReactNode
}

export function Conversation({ runtime, composer, placeholders, header }: ConversationProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const reading = useScrollEdges('vertical', { viewport, tabStop: true })
  const [earlier, setEarlier] = useState(false)
  const { title, turns, status, chatId, queue } = runtime
  const running = status === 'sending' || status === 'reconnecting'
  const last = turns.at(-1)
  const thread = useRef<HTMLDivElement>(null)
  // A new turn always comes into view, and scrolling back up is what stops it following.
  useLayoutEffect(() => {
    setEarlier(false)
    const el = viewport.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatId, last?.id])
  // A stream grows the last turn without changing its id, so follow the thread's size.
  useLayoutEffect(() => {
    const el = viewport.current
    if (earlier || !el || !thread.current) return
    const observer = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight
    })
    observer.observe(thread.current)
    return () => observer.disconnect()
  }, [earlier])
  return (
    <ChatRuntimeProvider runtime={runtime}>
      <div className={styles.chat}>
        <header className={styles.header} data-desktop-drag=''>
          {header ?? (
            <h1 data-type='T039'>
              <OverflowText text={title}>{title}</OverflowText>
            </h1>
          )}
          <ChatPanelTrigger />
        </header>
        <div
          className={styles.reading}
          role='region'
          aria-label='Conversation'
          ref={reading}
          onScroll={(event) => {
            const el = event.currentTarget
            setEarlier(el.scrollHeight - el.clientHeight - el.scrollTop > FOLLOW_SLACK)
          }}
        >
          <div className={styles.thread} ref={thread}>
            {status === 'loading' && (
              <p className={styles.turn} data-type='T048' role='status'>
                Loading conversation
              </p>
            )}
            {runtime.loadFailed && (
              <InlineNotice
                intent='danger'
                message='This conversation could not load.'
                action={
                  <Button variant='muted' size='compact' onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                }
              />
            )}
            {groupExchanges(turns).map((exchange) => (
              <article key={exchange[0].id} className={styles.turn}>
                {exchange.map((turn) => (
                  <Turn key={turn.id} turn={turn} />
                ))}
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
            <QueuedMessages runtime={runtime} />
            <MessageComposer
              composer={composer}
              placeholder={
                running
                  ? placeholders.running
                  : turns.length
                    ? placeholders.followUp
                    : placeholders.first
              }
              onSubmit={runtime.send}
              onStop={running ? runtime.stop : undefined}
              onSendQueuedHead={queue.length ? () => runtime.sendQueuedNow() : undefined}
              onRecallQueued={() => {
                const tail = queue.at(-1)
                if (!tail || tail.locked) return false
                runtime.editQueued(tail.id)
                return true
              }}
            />
          </div>
        </div>
      </div>
    </ChatRuntimeProvider>
  )
}
