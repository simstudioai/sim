'use client'

import { memo, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { InlineNotice } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { PageColumn, PageOverflow } from '@sim/emcn-platform/page-column'
import styles from '@/app/(product)/_components/chat/conversation/conversation.module.css'
import { ResponseMessage } from '@/app/(product)/_components/chat/message/response-message'
import { UserMessage } from '@/app/(product)/_components/chat/message/user-message'
import type { ChatRuntime, PlatformTurn } from '@/app/(product)/_components/chat/model'
import { ChatPanelTrigger } from '@/app/(product)/_components/chat/panel/chat-panels'
import { MessageComposer } from '@/app/(product)/_components/composer/message-composer'
import type { ComposerController } from '@/app/(product)/_components/composer/model'
import { ChatRuntimeProvider } from '@/app/(product)/_components/session/chat-runtime'

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
  const { title, turns, status, chatId } = runtime
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
          <PageColumn>
            <div className={styles.thread} ref={thread}>
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
          </PageColumn>
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
          <PageColumn>
            <PageOverflow>
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
                history={turns.flatMap((turn) =>
                  turn.role === 'user' && (turn.prompt.text || turn.prompt.attachments.length)
                    ? [{ id: turn.id, draft: turn.prompt }]
                    : []
                )}
              />
            </PageOverflow>
          </PageColumn>
        </div>
      </div>
    </ChatRuntimeProvider>
  )
}
