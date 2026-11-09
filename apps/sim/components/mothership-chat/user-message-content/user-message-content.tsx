'use client'

import { useMemo } from 'react'
import { cn } from '@sim/emcn-legacy'
import { useChatChrome } from '@/components/mothership-chat/chat-surface-context'
import { ContextMentionIcon } from '@/components/mothership-chat/context-mention-icon'
import { PageContext } from '@/components/mothership-chat/message-content/components/page-context'
import { ResourceMention } from '@/components/mothership-chat/message-content/components/resource-mention'
import { computeMentionRanges } from '@/components/mothership-chat/user-message-content/utils'
import type { ChatMessageContext } from '@/lib/mothership/chat/types'

const USER_MESSAGE_CLASSES =
  'whitespace-pre-wrap [overflow-wrap:anywhere] text-base text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'

const COMPACT_CLASSES =
  'truncate text-small leading-[20px] text-[var(--text-primary)] tracking-[0] antialiased'

interface UserMessageContentProps {
  content: string
  contexts?: ChatMessageContext[]
  className?: string
  /** When true, render mentions as plain inline text (no icon/pill) so truncation flows naturally. */
  plainMentions?: boolean
  /** Use compact single-line layout with truncation. */
  compact?: boolean
}

interface MentionHighlightProps {
  context: ChatMessageContext
}

function MentionHighlight({ context }: MentionHighlightProps) {
  if (context.kind === 'browser_page' && context.snapshot) {
    return <PageContext snapshot={context.snapshot} label={context.label} />
  }
  return (
    <ResourceMention
      title={context.label ?? ''}
      icon={
        <ContextMentionIcon
          context={context}
          className='size-[12px] shrink-0 text-[var(--text-icon)]'
        />
      }
    />
  )
}

export function UserMessageContent({
  content,
  contexts,
  className,
  plainMentions = false,
  compact = false,
}: UserMessageContentProps) {
  const trimmed = content.trim()
  const { fontClassName } = useChatChrome()
  const classes = cn(fontClassName, compact ? COMPACT_CLASSES : USER_MESSAGE_CLASSES, className)

  const ranges = useMemo(() => computeMentionRanges(content, contexts ?? []), [content, contexts])

  if (ranges.length === 0) {
    return <p className={classes}>{trimmed}</p>
  }

  const elements: React.ReactNode[] = []
  let lastIndex = 0

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]

    if (range.start > lastIndex) {
      const before = content.slice(lastIndex, range.start)
      elements.push(<span key={`text-${i}-${lastIndex}`}>{before}</span>)
    }

    if (plainMentions) {
      elements.push(
        <span key={`mention-${i}-${range.start}`} className='text-[var(--text-primary)]'>
          {content.slice(range.start, range.end)}
        </span>
      )
    } else {
      elements.push(
        <MentionHighlight key={`mention-${i}-${range.start}`} context={range.context} />
      )
    }
    lastIndex = range.end
  }

  const tail = content.slice(lastIndex)
  if (tail) {
    elements.push(<span key={`tail-${lastIndex}`}>{tail}</span>)
  }

  return <p className={classes}>{elements}</p>
}
