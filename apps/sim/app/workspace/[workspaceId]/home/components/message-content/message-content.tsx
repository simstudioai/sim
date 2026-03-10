'use client'

import type { ContentBlock, OptionItem, SubagentName, ToolCallStatus } from '../../types'
import { SUBAGENT_LABELS } from '../../types'
import { ChatContent, Options, Subagent, ToolCall } from './components'

interface TextSegment {
  type: 'text'
  content: string
}

interface ToolCallSegment {
  type: 'tool_call'
  id: string
  toolName: string
  displayTitle?: string
  status: ToolCallStatus
  phaseLabel?: string
}

interface SubagentSegment {
  type: 'subagent'
  id: string
  name: string
  label: string
  status: ToolCallStatus
}

interface OptionsSegment {
  type: 'options'
  items: OptionItem[]
}

type MessageSegment = TextSegment | ToolCallSegment | SubagentSegment | OptionsSegment

function formatToolName(name: string): string {
  return name
    .replace(/_v\d+$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Flattens raw content blocks into typed segments for rendering.
 * Each content type maps to its own segment with all available data preserved.
 */
function parseBlocks(blocks: ContentBlock[], isStreaming: boolean): MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastSubagentIdx = -1
  for (let j = blocks.length - 1; j >= 0; j--) {
    if (blocks[j].type === 'subagent') {
      lastSubagentIdx = j
      break
    }
  }

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
          const key = block.content
          segments.push({
            type: 'subagent',
            id: `subagent-${i}`,
            name: key,
            label: SUBAGENT_LABELS[key as SubagentName] ?? key,
            status: isStreaming && i === lastSubagentIdx ? 'executing' : 'success',
          })
        }
        break
      }
      case 'tool_call': {
        if (block.toolCall) {
          segments.push({
            type: 'tool_call',
            id: block.toolCall.id,
            toolName: block.toolCall.name,
            displayTitle: block.toolCall.displayTitle || formatToolName(block.toolCall.name),
            status: block.toolCall.status,
            phaseLabel: block.toolCall.phaseLabel,
          })
        }
        break
      }
      case 'options': {
        if (block.options?.length) {
          segments.push({ type: 'options', items: block.options })
        }
        break
      }
    }
  }

  return segments
}

interface MessageContentProps {
  blocks: ContentBlock[]
  fallbackContent: string
  isStreaming: boolean
  onOptionSelect?: (id: string) => void
}

export function MessageContent({
  blocks,
  fallbackContent,
  isStreaming,
  onOptionSelect,
}: MessageContentProps) {
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
        switch (segment.type) {
          case 'text':
            return <ChatContent key={`text-${i}`} content={segment.content} />
          case 'tool_call':
            return (
              <ToolCall
                key={segment.id}
                id={segment.id}
                toolName={segment.toolName}
                displayTitle={segment.displayTitle}
                status={segment.status}
                phaseLabel={segment.phaseLabel}
              />
            )
          case 'subagent':
            return (
              <Subagent
                key={segment.id}
                id={segment.id}
                name={segment.name}
                label={segment.label}
                status={segment.status}
              />
            )
          case 'options':
            return <Options key={`options-${i}`} items={segment.items} onSelect={onOptionSelect} />
        }
      })}
    </div>
  )
}
