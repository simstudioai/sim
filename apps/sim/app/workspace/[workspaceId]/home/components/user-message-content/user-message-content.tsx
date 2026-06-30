'use client'

import { useMemo } from 'react'
import { cn } from '@sim/emcn'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'
import { getIntegrationMatcher } from '@/blocks/integration-matcher'

const USER_MESSAGE_CLASSES =
  'whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-[430] font-[family-name:var(--font-inter)] text-base text-[var(--text-primary)] leading-[23px] tracking-[0] antialiased'

const COMPACT_CLASSES =
  'truncate text-small leading-[20px] font-[430] font-[family-name:var(--font-inter)] text-[var(--text-primary)] tracking-[0] antialiased'

interface UserMessageContentProps {
  content: string
  contexts?: ChatMessageContext[]
  className?: string
  /** When true, render mentions as plain inline text (no icon/pill) so truncation flows naturally. */
  plainMentions?: boolean
  /** Use compact single-line layout with truncation. */
  compact?: boolean
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface MentionRange {
  start: number
  end: number
  context: ChatMessageContext
}

/**
 * Backfills a renderable `blockType` onto integration contexts that are
 * missing one (or carry one the registry no longer knows) by resolving the
 * label through the integration matcher. Messages persisted before
 * `blockType` was included in the save mapping would otherwise render a
 * mention pill with no icon.
 */
function withResolvedBlockType(ctx: ChatMessageContext): ChatMessageContext {
  if (ctx.kind !== 'integration' || !ctx.label) return ctx
  const info = getIntegrationMatcher().byName.get(ctx.label.toLowerCase())
  if (!info) return ctx
  return { ...ctx, blockType: info.blockType }
}

function computeMentionRanges(text: string, contexts: ChatMessageContext[]): MentionRange[] {
  const ranges: MentionRange[] = []

  for (const rawCtx of contexts) {
    if (!rawCtx.label) continue
    const ctx = withResolvedBlockType(rawCtx)
    const prefix = ctx.kind === 'skill' ? '/' : '@'
    const token = `${prefix}${ctx.label}`
    const pattern = new RegExp(`(^|\\s)(${escapeRegex(token)})(\\s|$)`, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const leadingSpace = match[1]
      const tokenStart = match.index + leadingSpace.length
      const tokenEnd = tokenStart + token.length
      ranges.push({ start: tokenStart, end: tokenEnd, context: ctx })
    }
  }

  for (const range of computeIntegrationRanges(text, ranges)) {
    ranges.push(range)
  }

  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

/**
 * Scans the raw text for explicit, token-starting `@IntegrationName` mentions
 * (any casing) and decorates them even when no matching context was stored —
 * e.g. a message submitted before the input's auto-mention pass ran, or one
 * authored outside the chat input. Ranges already claimed by stored contexts
 * are skipped so the two sources never double-decorate.
 */
function computeIntegrationRanges(text: string, taken: MentionRange[]): MentionRange[] {
  const { regex, byName } = getIntegrationMatcher()
  if (!regex || !text) return []

  regex.lastIndex = 0
  const ranges: MentionRange[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const atIndex = match.index - 1
    if (atIndex < 0 || text[atIndex] !== '@') continue
    if (atIndex > 0 && !/\s/.test(text[atIndex - 1])) continue
    const info = byName.get(match[0].toLowerCase())
    if (!info) continue
    const start = atIndex
    const end = match.index + match[0].length
    if (taken.some((r) => start < r.end && end > r.start)) continue
    ranges.push({
      start,
      end,
      context: { kind: 'integration', blockType: info.blockType, label: info.name },
    })
  }

  return ranges
}

function MentionHighlight({ context }: { context: ChatMessageContext }) {
  return (
    <span className='inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px]'>
      <ContextMentionIcon
        context={context}
        className='relative top-0.5 size-[12px] flex-shrink-0 text-[var(--text-icon)]'
      />
      {context.label}
    </span>
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
  const classes = cn(compact ? COMPACT_CLASSES : USER_MESSAGE_CLASSES, className)

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
        <span
          key={`mention-${i}-${range.start}`}
          className='font-medium text-[var(--text-primary)]'
        >
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
