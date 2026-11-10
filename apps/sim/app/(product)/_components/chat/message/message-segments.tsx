'use client'

import type { ComponentType, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { Button } from '@sim/emcn/button'
import { InlineNotice } from '@sim/emcn/status'
import { QuestionCard } from '@/app/(product)/_components/chat/cards/question-card'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import { MarkdownContent } from '@/app/(product)/_components/markdown-content/markdown-content'
import { useChatHandlers } from '@/app/(product)/_components/session/chat-runtime'
import type {
  PlatformCredentialRequest,
  PlatformCredentialSubmission,
  PlatformSegment,
} from '@/platform/lib/data/models/chat'

export interface CredentialCardProps {
  items: readonly PlatformCredentialRequest[]
  submission?: PlatformCredentialSubmission
  abandoned?: boolean
  onSubmit: (message: string) => void
}

export interface UsageNoticeProps {
  action: string
  reason?: string
  message: string
}

/** One assistant turn's action history, read by the stream it ran on. */
export interface TurnReceiptsProps {
  chatId: string
  streamId: string
  /** The turn is still streaming, so its receipts poll. */
  active: boolean
  mountedTurnCount: number
  /** The turn's transcript tool calls whose receipts are read by id when no page covers them. */
  candidateIds: readonly string[]
  /** Review cards of the actions still waiting, placed among the receipts in turn order. */
  pending: readonly PendingReviewCard[]
}

/** An action still waiting for review, shown as its review card where its receipt would be. */
interface PendingReviewCard {
  id: string
  sequence?: number
  card: ReactNode
}

/** Cards that talk to a backend, supplied by the live chat. A fixture transcript carries none. */
export interface ChatCards {
  Credential: ComponentType<CredentialCardProps>
  Usage: ComponentType<UsageNoticeProps>
  TurnReceipts?: ComponentType<TurnReceiptsProps>
}

const Cards = createContext<ChatCards | null>(null)
export const ChatCardsProvider = Cards.Provider

/** The live chat's backend cards, or null in a fixture transcript. */
export function useChatCards(): ChatCards | null {
  return useContext(Cards)
}

function Segment({ segment }: { segment: PlatformSegment }) {
  const runtime = useChatHandlers()
  const cards = useContext(Cards)
  switch (segment.kind) {
    case 'markdown':
      return <MarkdownContent text={segment.text} />
    case 'options':
      return (
        <div className={styles.options}>
          {segment.options.map((option) => (
            <Button
              key={option.id}
              variant='muted'
              size='compact'
              onClick={() => runtime.sendText(option.label)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )
    case 'question':
      return (
        <QuestionCard
          questions={segment.questions}
          answers={segment.answers}
          onSubmit={runtime.sendText}
        />
      )
    case 'credential':
      return cards ? (
        <cards.Credential
          items={segment.items}
          submission={segment.submission}
          abandoned={segment.abandoned}
          onSubmit={runtime.sendText}
        />
      ) : null
    case 'resource':
      return (
        <Button
          variant='muted'
          size='compact'
          disabled={!runtime.openResource}
          onClick={() =>
            runtime.openResource?.({
              type: segment.type,
              id: segment.id,
              title: segment.title,
              workspaceId: segment.workspaceId,
            })
          }
        >
          {segment.title}
        </Button>
      )
    case 'usage':
      return cards ? (
        <cards.Usage action={segment.action} reason={segment.reason} message={segment.message} />
      ) : (
        <InlineNotice intent='warning' message={segment.message} />
      )
    case 'failure':
      return <InlineNotice intent='danger' message={segment.message} />
    case 'pending':
      return (
        <p className={styles.status} data-type='T048' role='status'>
          {segment.label}
        </p>
      )
  }
}

export function MessageSegments({ segments }: { segments: readonly PlatformSegment[] }) {
  return segments.map((segment, index) => (
    // Segments are positional: the stream only appends, so an index stays the same segment.
    <Segment key={`${segment.kind}:${index}`} segment={segment} />
  ))
}
