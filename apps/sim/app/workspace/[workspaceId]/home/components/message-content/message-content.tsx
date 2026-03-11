'use client'

import type { ContentBlock, OptionItem, SubagentName, ToolCallStatus } from '../../types'
import { SUBAGENT_LABELS } from '../../types'
import { AgentGroup, ChatContent, Options } from './components'

interface TextSegment {
  type: 'text'
  content: string
}

interface ToolCallData {
  id: string
  toolName: string
  displayTitle: string
  status: ToolCallStatus
}

interface AgentGroupSegment {
  type: 'agent_group'
  id: string
  agentName: string
  agentLabel: string
  tools: ToolCallData[]
}

interface OptionsSegment {
  type: 'options'
  items: OptionItem[]
}

type MessageSegment = TextSegment | AgentGroupSegment | OptionsSegment

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
    displayTitle: tc.displayTitle || formatToolName(tc.name),
    status: tc.status,
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

    if (block.type === 'text' || block.type === 'subagent_text') {
      if (!block.content?.trim()) continue
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
        tools: [],
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
            tools: [],
          }
        }
        continue
      }

      const tool = toToolData(tc)

      if (tc.calledBy && group && group.agentName === tc.calledBy) {
        group.tools.push(tool)
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
          tools: [tool],
        }
      } else {
        if (group && group.agentName === 'mothership') {
          group.tools.push(tool)
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
            tools: [tool],
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

export function MessageContent({ blocks, fallbackContent, onOptionSelect }: MessageContentProps) {
  const parsed = blocks.length > 0 ? parseBlocks(blocks) : []

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
          case 'agent_group':
            return (
              <AgentGroup
                key={segment.id}
                agentName={segment.agentName}
                agentLabel={segment.agentLabel}
                tools={segment.tools}
              />
            )
          case 'options':
            return <Options key={`options-${i}`} items={segment.items} onSelect={onOptionSelect} />
        }
      })}
    </div>
  )
}
