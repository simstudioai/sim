'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/core/utils/cn'
import { useThrottledValue } from '@/hooks/use-throttled-value'
import type { ContentBlock, ToolCallStatus } from '../../types'

const REMARK_PLUGINS = [remarkGfm]

const PROSE_CLASSES = cn(
  'prose prose-base dark:prose-invert max-w-none font-body font-[380]',
  'prose-headings:font-semibold prose-headings:tracking-[-0.01em] prose-headings:text-[var(--text-primary)]',
  'prose-headings:mb-[12px] prose-headings:mt-[20px]',
  'prose-p:text-[16px] prose-p:leading-[1.75] prose-p:tracking-[-0.015em] prose-p:text-[var(--text-primary)]',
  'prose-p:mb-[8px]',
  'prose-li:text-[16px] prose-li:leading-[1.75] prose-li:tracking-[-0.015em] prose-li:text-[var(--text-primary)]',
  'prose-li:my-[4px]',
  'prose-ul:my-[12px] prose-ol:my-[12px]',
  'prose-strong:font-semibold prose-strong:text-[var(--text-primary)]',
  'prose-a:text-[var(--brand-secondary)]',
  'prose-code:rounded-[4px] prose-code:bg-[var(--surface-5)] prose-code:px-[5px] prose-code:py-[2px] prose-code:text-[13px] prose-code:font-mono prose-code:font-normal prose-code:text-[var(--text-primary)]',
  'prose-pre:my-[14px] prose-pre:rounded-[8px] prose-pre:bg-[var(--surface-5)] prose-pre:text-[13px]',
  'prose-hr:border-[var(--divider)]'
)

function formatToolName(name: string): string {
  return name
    .replace(/_v\d+$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface TextSegment {
  type: 'text'
  content: string
}

interface ActionSegment {
  type: 'action'
  id: string
  label: string
  status: ToolCallStatus
}

type MessageSegment = TextSegment | ActionSegment

/**
 * Flattens raw content blocks into a uniform list of text and action segments.
 * Tool calls and subagents are treated identically as action items.
 */
function parseBlocks(blocks: ContentBlock[], isStreaming: boolean): MessageSegment[] {
  const segments: MessageSegment[] = []
  const lastSubagentIdx = blocks.findLastIndex((b) => b.type === 'subagent')

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    switch (block.type) {
      case 'text': {
        if (block.content?.trim()) {
          const last = segments[segments.length - 1]
          if (last?.type === 'text') {
            last.content += block.content
          } else {
            segments.push({ type: 'text', content: block.content })
          }
        }
        break
      }
      case 'subagent': {
        if (block.content) {
          segments.push({
            type: 'action',
            id: `subagent-${i}`,
            label: block.content,
            status: isStreaming && i === lastSubagentIdx ? 'executing' : 'success',
          })
        }
        break
      }
      case 'tool_call': {
        if (block.toolCall) {
          segments.push({
            type: 'action',
            id: block.toolCall.id,
            label: block.toolCall.displayTitle || formatToolName(block.toolCall.name),
            status: block.toolCall.status,
          })
        }
        break
      }
    }
  }

  return segments
}

function ThrottledTextSegment({ content }: { content: string }) {
  const throttled = useThrottledValue(content)
  return (
    <div className={PROSE_CLASSES}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{throttled}</ReactMarkdown>
    </div>
  )
}

interface MessageContentProps {
  blocks: ContentBlock[]
  fallbackContent: string
  isStreaming: boolean
}

export function MessageContent({ blocks, fallbackContent, isStreaming }: MessageContentProps) {
  const parsed = blocks.length > 0 ? parseBlocks(blocks, isStreaming) : []

  const segments: MessageSegment[] =
    parsed.length > 0
      ? parsed
      : fallbackContent?.trim()
        ? [{ type: 'text' as const, content: fallbackContent }]
        : []

  if (segments.length === 0) return null

  return (
    <div className='space-y-[10px]'>
      {segments.map((segment, i) => {
        if (segment.type === 'text') {
          return <ThrottledTextSegment key={`text-${i}`} content={segment.content} />
        }

        return (
          <div key={segment.id} className='font-base text-[13px] text-[var(--text-tertiary)]'>
            {segment.label}
          </div>
        )
      })}
    </div>
  )
}
