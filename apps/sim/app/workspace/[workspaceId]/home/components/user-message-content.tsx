'use client'

import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { ChatMessageContext } from '../types'

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
  token: string
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
      ranges.push({ start: tokenStart, end: tokenEnd, token, context: ctx })
    }
  }

  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

function MentionHighlight({ context, token }: { context: ChatMessageContext; token: string }) {
  const workflowColor = useWorkflowRegistry((state) => {
    if (context.kind === 'workflow' || context.kind === 'current_workflow') {
      return state.workflows[context.workflowId || '']?.color ?? null
    }
    return null
  })

  const bgColor = workflowColor ? `${workflowColor}40` : 'rgba(50, 189, 126, 0.4)'

  return (
    <span className='rounded-[4px] px-[2px] py-[1px]' style={{ backgroundColor: bgColor }}>
      {token}
    </span>
  )
}

export function UserMessageContent({ content, contexts }: UserMessageContentProps) {
  if (!contexts || contexts.length === 0) {
    return (
      <p className='whitespace-pre-wrap font-[430] font-[family-name:var(--font-inter)] text-[15px] text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'>
        {content}
      </p>
    )
  }

  const ranges = computeMentionRanges(content, contexts)

  if (ranges.length === 0) {
    return (
      <p className='whitespace-pre-wrap font-[430] font-[family-name:var(--font-inter)] text-[15px] text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'>
        {content}
      </p>
    )
  }

  const elements: React.ReactNode[] = []
  let lastIndex = 0

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]

    if (range.start > lastIndex) {
      const before = content.slice(lastIndex, range.start)
      elements.push(<span key={`text-${i}-${lastIndex}`}>{before}</span>)
    }

    elements.push(
      <MentionHighlight
        key={`mention-${i}-${range.start}`}
        context={range.context}
        token={range.token}
      />
    )
    lastIndex = range.end
  }

  const tail = content.slice(lastIndex)
  if (tail) {
    elements.push(<span key={`tail-${lastIndex}`}>{tail}</span>)
  }

  return (
    <p className='whitespace-pre-wrap font-[430] font-[family-name:var(--font-inter)] text-[15px] text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'>
      {elements}
    </p>
  )
}
