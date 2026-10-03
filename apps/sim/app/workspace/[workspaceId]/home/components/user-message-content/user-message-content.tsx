'use client'

import { useMemo } from 'react'
import { cn } from '@sim/emcn'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import { ResourceMention } from '@/app/workspace/[workspaceId]/home/components/message-content/components/resource-mention'
import { computeMentionRanges } from '@/app/workspace/[workspaceId]/home/components/user-message-content/utils'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'

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

function MentionHighlight({ context }: { context: ChatMessageContext }) {
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
  const classes = cn(inter.className, compact ? COMPACT_CLASSES : USER_MESSAGE_CLASSES, className)

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
