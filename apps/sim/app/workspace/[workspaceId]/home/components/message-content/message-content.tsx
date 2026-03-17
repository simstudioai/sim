'use client'

import type { ContentBlock, OptionItem, SubagentName, ToolCallData } from '../../types'
import { SUBAGENT_LABELS, TOOL_UI_METADATA } from '../../types'
import type { AgentGroupItem } from './components'
import { AgentGroup, ChatContent, CircleStop, Options, PendingTagIndicator } from './components'

interface TextSegment {
  type: 'text'
  content: string
}

interface AgentGroupSegment {
  type: 'agent_group'
  id: string
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
}

interface OptionsSegment {
  type: 'options'
  items: OptionItem[]
}

interface StoppedSegment {
  type: 'stopped'
}

type MessageSegment = TextSegment | AgentGroupSegment | OptionsSegment | StoppedSegment

const SUBAGENT_KEYS = new Set(Object.keys(SUBAGENT_LABELS))

function formatToolName(name: string): string {
  return name
    .replace(/_v\d+$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function resolveAgentLabel(key: string): string {
  return SUBAGENT_LABELS[key as SubagentName] ?? formatToolName(key)
}

function toToolData(tc: NonNullable<ContentBlock['toolCall']>): ToolCallData {
  return {
    id: tc.id,
    toolName: tc.name,
    displayTitle:
      tc.displayTitle ||
      TOOL_UI_METADATA[tc.name as keyof typeof TOOL_UI_METADATA]?.title ||
      formatToolName(tc.name),
    status: tc.status,
    result: tc.result,
  }
}

/**
 * Groups content blocks into agent-scoped segments.
 * Dispatch tool_calls (name matches a subagent key, no calledBy) are absorbed
 * into the agent header. Inner tool_calls are nested underneath their agent.
 * Orphan tool_calls (no calledBy, not a dispatch) group under "Mothership".
 */
function parseBlocks(blocks: ContentBlock[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  let group: AgentGroupSegment | null = null

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'subagent_text') {
      if (!block.content || !group) continue
      const lastItem = group.items[group.items.length - 1]
      if (lastItem?.type === 'text') {
        lastItem.content += block.content
      } else {
        group.items.push({ type: 'text', content: block.content })
      }
      continue
    }

    if (block.type === 'text') {
      if (!block.content?.trim()) continue
      if (block.subagent && group && group.agentName === block.subagent) {
        const lastItem = group.items[group.items.length - 1]
        if (lastItem?.type === 'text') {
          lastItem.content += block.content
        } else {
          group.items.push({ type: 'text', content: block.content })
        }
        continue
      }
      if (group) {
        segments.push(group)
        group = null
      }
      const last = segments[segments.length - 1]
      if (last?.type === 'text') {
        last.content += block.content
      } else {
        segments.push({ type: 'text', content: block.content })
      }
      continue
    }

    if (block.type === 'subagent') {
      if (!block.content) continue
      const key = block.content
      if (group && group.agentName === key) continue
      if (group) {
        segments.push(group)
        group = null
      }
      group = {
        type: 'agent_group',
        id: `agent-${key}-${i}`,
        agentName: key,
        agentLabel: resolveAgentLabel(key),
        items: [],
      }
      continue
    }

    if (block.type === 'tool_call') {
      if (!block.toolCall) continue
      const tc = block.toolCall
      const isDispatch = SUBAGENT_KEYS.has(tc.name) && !tc.calledBy

      if (isDispatch) {
        if (!group || group.agentName !== tc.name) {
          if (group) {
            segments.push(group)
            group = null
          }
          group = {
            type: 'agent_group',
            id: `agent-${tc.name}-${i}`,
            agentName: tc.name,
            agentLabel: resolveAgentLabel(tc.name),
            items: [],
          }
        }
        continue
      }

      const tool = toToolData(tc)

      if (tc.calledBy && group && group.agentName === tc.calledBy) {
        group.items.push({ type: 'tool', data: tool })
      } else if (tc.calledBy) {
        if (group) {
          segments.push(group)
          group = null
        }
        group = {
          type: 'agent_group',
          id: `agent-${tc.calledBy}-${i}`,
          agentName: tc.calledBy,
          agentLabel: resolveAgentLabel(tc.calledBy),
          items: [{ type: 'tool', data: tool }],
        }
      } else {
        if (group && group.agentName === 'mothership') {
          group.items.push({ type: 'tool', data: tool })
        } else {
          if (group) {
            segments.push(group)
            group = null
          }
          group = {
            type: 'agent_group',
            id: `agent-mothership-${i}`,
            agentName: 'mothership',
            agentLabel: 'Mothership',
            items: [{ type: 'tool', data: tool }],
          }
        }
      }
      continue
    }

    if (block.type === 'options') {
      if (!block.options?.length) continue
      if (group) {
        segments.push(group)
        group = null
      }
      segments.push({ type: 'options', items: block.options })
      continue
    }

    if (block.type === 'subagent_end') {
      if (group) {
        segments.push(group)
        group = null
      }
      continue
    }

    if (block.type === 'stopped') {
      if (group) {
        segments.push(group)
        group = null
      }
      segments.push({ type: 'stopped' })
    }
  }

  if (group) segments.push(group)
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
  isStreaming = false,
  onOptionSelect,
}: MessageContentProps) {
  const parsed = blocks.length > 0 ? parseBlocks(blocks) : []

  const segments: MessageSegment[] =
    parsed.length > 0
      ? parsed
      : fallbackContent?.trim()
        ? [{ type: 'text' as const, content: fallbackContent }]
        : []

  if (segments.length === 0) return null

  const lastSegment = segments[segments.length - 1]
  const hasTrailingContent = lastSegment.type === 'text' || lastSegment.type === 'stopped'

  let allLastGroupToolsDone = false
  if (lastSegment.type === 'agent_group') {
    const toolItems = lastSegment.items.filter((item) => item.type === 'tool')
    allLastGroupToolsDone =
      toolItems.length > 0 &&
      toolItems.every(
        (t) =>
          t.type === 'tool' &&
          (t.data.status === 'success' ||
            t.data.status === 'error' ||
            t.data.status === 'cancelled')
      )
  }

  const hasSubagentEnded = blocks.some((b) => b.type === 'subagent_end')
  const showTrailingThinking =
    isStreaming && !hasTrailingContent && (hasSubagentEnded || allLastGroupToolsDone)

  return (
    <div className='space-y-[10px]'>
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'text':
            return (
              <ChatContent
                key={`text-${i}`}
                content={segment.content}
                isStreaming={isStreaming}
                onOptionSelect={onOptionSelect}
              />
            )
          case 'agent_group': {
            const toolItems = segment.items.filter((item) => item.type === 'tool')
            const allToolsDone =
              toolItems.length === 0 ||
              toolItems.every(
                (t) =>
                  t.type === 'tool' &&
                  (t.data.status === 'success' ||
                    t.data.status === 'error' ||
                    t.data.status === 'cancelled')
              )
            const hasFollowingText = segments.slice(i + 1).some((s) => s.type === 'text')
            return (
              <div key={segment.id} className={isStreaming ? 'animate-stream-fade-in' : undefined}>
                <AgentGroup
                  agentName={segment.agentName}
                  agentLabel={segment.agentLabel}
                  items={segment.items}
                  autoCollapse={allToolsDone && hasFollowingText}
                />
              </div>
            )
          }
          case 'options':
            return (
              <div
                key={`options-${i}`}
                className={isStreaming ? 'animate-stream-fade-in' : undefined}
              >
                <Options items={segment.items} onSelect={onOptionSelect} />
              </div>
            )
          case 'stopped':
            return (
              <div key={`stopped-${i}`} className='flex items-center gap-[8px]'>
                <CircleStop className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='font-base text-[14px] text-[var(--text-body)]'>
                  Stopped by user
                </span>
              </div>
            )
        }
      })}
      {showTrailingThinking && (
        <div className='animate-stream-fade-in-delayed opacity-0'>
          <PendingTagIndicator />
        </div>
      )}
    </div>
  )
}
