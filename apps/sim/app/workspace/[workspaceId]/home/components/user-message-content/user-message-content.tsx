'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'
import { useWorkflows } from '@/hooks/queries/workflows'

const USER_MESSAGE_CLASSES =
  'whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-[430] font-[family-name:var(--font-inter)] text-base text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'

interface UserMessageContentProps {
  content: string
  contexts?: ChatMessageContext[]
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface MentionRange {
  start: number
  end: number
  context: ChatMessageContext
}

function computeMentionRanges(text: string, contexts: ChatMessageContext[]): MentionRange[] {
  const ranges: MentionRange[] = []

  for (const ctx of contexts) {
    if (!ctx.label) continue
    const token = `@${ctx.label}`
    const pattern = new RegExp(`(^|\\s)(${escapeRegex(token)})(\\s|$)`, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const leadingSpace = match[1]
      const tokenStart = match.index + leadingSpace.length
      const tokenEnd = tokenStart + token.length
      ranges.push({ start: tokenStart, end: tokenEnd, context: ctx })
    }
  }

  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

function MentionHighlight({ context }: { context: ChatMessageContext }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflowList } = useWorkflows(workspaceId)
  const workflowColor = useMemo(() => {
    if (context.kind !== 'workflow' && context.kind !== 'current_workflow') return null
    return (workflowList ?? []).find((w) => w.id === context.workflowId)?.color ?? null
  }, [workflowList, context.kind, context.workflowId])

  return (
    <span className='inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px]'>
      <ContextMentionIcon
        context={context}
        workflowColor={workflowColor}
        className='relative top-0.5 h-[12px] w-[12px] flex-shrink-0 text-[var(--text-icon)]'
      />
      {context.label}
    </span>
  )
}

export function UserMessageContent({ content, contexts }: UserMessageContentProps) {
  if (!contexts || contexts.length === 0) {
    return <p className={USER_MESSAGE_CLASSES}>{content}</p>
  }

  const ranges = computeMentionRanges(content, contexts)

  if (ranges.length === 0) {
    return <p className={USER_MESSAGE_CLASSES}>{content}</p>
  }

  const elements: React.ReactNode[] = []
  let lastIndex = 0

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]

    if (range.start > lastIndex) {
      const before = content.slice(lastIndex, range.start)
      elements.push(<span key={`text-${i}-${lastIndex}`}>{before}</span>)
    }

    elements.push(<MentionHighlight key={`mention-${i}-${range.start}`} context={range.context} />)
    lastIndex = range.end
  }

  const tail = content.slice(lastIndex)
  if (tail) {
    elements.push(<span key={`tail-${lastIndex}`}>{tail}</span>)
  }

  return <p className={USER_MESSAGE_CLASSES}>{elements}</p>
}
