'use client'

import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components'
import {
  AgentGroup,
  ChatContent,
  CircleStop,
  Options,
  PendingTagIndicator,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components'
import type {
  ContentBlock,
  MothershipToolName,
  OptionItem,
  SubagentName,
  ToolCallData,
} from '@/app/workspace/[workspaceId]/home/types'
import { SUBAGENT_LABELS, TOOL_UI_METADATA } from '@/app/workspace/[workspaceId]/home/types'

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
  isDelegating: boolean
  isOpen: boolean
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

/**
 * Maps subagent names to the Mothership tool that dispatches them when the
 * tool name differs from the subagent name (e.g. `workspace_file` → `file_write`).
 * When a `subagent` block arrives, any trailing dispatch tool in the previous
 * group is absorbed so it doesn't render as a separate Mothership entry.
 */
const SUBAGENT_DISPATCH_TOOLS: Record<string, string> = {
  file_write: 'workspace_file',
}

function resolveAgentLabel(key: string): string {
  return SUBAGENT_LABELS[key as SubagentName] ?? key
}

function isToolDone(status: ToolCallData['status']): boolean {
  return status === 'success' || status === 'error' || status === 'cancelled'
}

function isDelegatingTool(tc: NonNullable<ContentBlock['toolCall']>): boolean {
  return tc.status === 'executing'
}

function toToolData(tc: NonNullable<ContentBlock['toolCall']>): ToolCallData {
  return {
    id: tc.id,
    toolName: tc.name,
    displayTitle:
      tc.displayTitle ?? TOOL_UI_METADATA[tc.name as MothershipToolName]?.title ?? tc.name,
    status: tc.status,
    params: tc.params,
    result: tc.result,
    streamingArgs: tc.streamingArgs,
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
  const pushGroup = (nextGroup: AgentGroupSegment, isOpen = false) => {
    segments.push({ ...nextGroup, isOpen })
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'subagent_text') {
      if (!block.content || !group) continue
      group.isDelegating = false
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
      if (block.subagent) {
        if (group && group.agentName === block.subagent) {
          group.isDelegating = false
          const lastItem = group.items[group.items.length - 1]
          if (lastItem?.type === 'text') {
            lastItem.content += block.content
          } else {
            group.items.push({ type: 'text', content: block.content })
          }
          continue
        }
      }
      if (group) {
        pushGroup(group)
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

      const dispatchToolName = SUBAGENT_DISPATCH_TOOLS[key]
      let inheritedDelegation = false
      if (group && dispatchToolName) {
        const last: AgentGroupItem | undefined = group.items[group.items.length - 1]
        if (last?.type === 'tool' && last.data.toolName === dispatchToolName) {
          inheritedDelegation = !isToolDone(last.data.status) && Boolean(last.data.streamingArgs)
          group.items.pop()
        }
        if (group.items.length > 0) {
          pushGroup(group)
        }
        group = null
      } else if (group) {
        pushGroup(group)
        group = null
      }

      group = {
        type: 'agent_group',
        id: `agent-${key}-${i}`,
        agentName: key,
        agentLabel: resolveAgentLabel(key),
        items: [],
        isDelegating: inheritedDelegation,
        isOpen: false,
      }
      continue
    }

    if (block.type === 'tool_call') {
      if (!block.toolCall) continue
      const tc = block.toolCall
      if (tc.name === 'tool_search_tool_regex') continue
      const isDispatch = SUBAGENT_KEYS.has(tc.name) && !tc.calledBy

      if (isDispatch) {
        if (!group || group.agentName !== tc.name) {
          if (group) {
            pushGroup(group)
            group = null
          }
          group = {
            type: 'agent_group',
            id: `agent-${tc.name}-${i}`,
            agentName: tc.name,
            agentLabel: resolveAgentLabel(tc.name),
            items: [],
            isDelegating: false,
            isOpen: false,
          }
        }
        group.isDelegating = isDelegatingTool(tc)
        continue
      }

      const tool = toToolData(tc)

      if (tc.calledBy && group && group.agentName === tc.calledBy) {
        group.isDelegating = false
        group.items.push({ type: 'tool', data: tool })
      } else if (tc.calledBy) {
        if (group) {
          pushGroup(group)
          group = null
        }
        group = {
          type: 'agent_group',
          id: `agent-${tc.calledBy}-${i}`,
          agentName: tc.calledBy,
          agentLabel: resolveAgentLabel(tc.calledBy),
          items: [{ type: 'tool', data: tool }],
          isDelegating: false,
          isOpen: false,
        }
      } else {
        if (group && group.agentName === 'mothership') {
          group.items.push({ type: 'tool', data: tool })
        } else {
          if (group) {
            pushGroup(group)
            group = null
          }
          group = {
            type: 'agent_group',
            id: `agent-mothership-${i}`,
            agentName: 'mothership',
            agentLabel: 'Mothership',
            items: [{ type: 'tool', data: tool }],
            isDelegating: false,
            isOpen: false,
          }
        }
      }
      continue
    }

    if (block.type === 'options') {
      if (!block.options?.length) continue
      if (group) {
        pushGroup(group)
        group = null
      }
      segments.push({ type: 'options', items: block.options })
      continue
    }

    if (block.type === 'subagent_end') {
      if (group) {
        pushGroup(group)
        group = null
      }
      continue
    }

    if (block.type === 'stopped') {
      if (group) {
        pushGroup(group)
        group = null
      }
      segments.push({ type: 'stopped' })
    }
  }

  if (group) pushGroup(group, true)
  return segments
}

/**
 * Mirrors the segment resolution inside {@link MessageContent} so list renderers
 * can tell whether an assistant message has anything visible yet. Avoids treating
 * `contentBlocks: [{ type: 'text', content: '' }]` as "has content" — that briefly
 * made MessageContent return null while streaming and caused a double Thinking flash.
 */
export function assistantMessageHasRenderableContent(
  blocks: ContentBlock[],
  fallbackContent: string
): boolean {
  const parsed = blocks.length > 0 ? parseBlocks(blocks) : []
  const segments: MessageSegment[] =
    parsed.length > 0
      ? parsed
      : fallbackContent.trim()
        ? [{ type: 'text' as const, content: fallbackContent }]
        : []
  return segments.length > 0
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

  if (segments.length === 0) {
    if (isStreaming) {
      return (
        <div className='space-y-2.5'>
          <PendingTagIndicator />
        </div>
      )
    }
    return null
  }

  const lastSegment = segments[segments.length - 1]
  const hasTrailingContent = lastSegment.type === 'text' || lastSegment.type === 'stopped'

  let allLastGroupToolsDone = false
  if (lastSegment.type === 'agent_group') {
    const toolItems = lastSegment.items.filter((item) => item.type === 'tool')
    allLastGroupToolsDone =
      toolItems.length > 0 && toolItems.every((t) => t.type === 'tool' && isToolDone(t.data.status))
  }

  const hasSubagentEnded = blocks.some((b) => b.type === 'subagent_end')
  const showTrailingThinking =
    isStreaming && !hasTrailingContent && (hasSubagentEnded || allLastGroupToolsDone)
  const lastOpenSubagentGroupId = [...segments]
    .reverse()
    .find(
      (segment): segment is AgentGroupSegment =>
        segment.type === 'agent_group' && segment.agentName !== 'mothership' && segment.isOpen
    )?.id

  return (
    <div className='space-y-2.5'>
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
              toolItems.every((t) => t.type === 'tool' && isToolDone(t.data.status))
            const hasFollowingText = segments.slice(i + 1).some((s) => s.type === 'text')
            return (
              <div key={segment.id} className={isStreaming ? 'animate-stream-fade-in' : undefined}>
                <AgentGroup
                  key={segment.id}
                  agentName={segment.agentName}
                  agentLabel={segment.agentLabel}
                  items={segment.items}
                  isDelegating={segment.isDelegating}
                  autoCollapse={allToolsDone && hasFollowingText}
                  defaultExpanded={segment.id === lastOpenSubagentGroupId}
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
              <div key={`stopped-${i}`} className='flex items-center gap-2'>
                <CircleStop className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='font-base text-[var(--text-body)] text-sm'>Stopped by user</span>
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
