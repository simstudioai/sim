'use client'

import {
  Read as ReadTool,
  ToolSearchToolRegex,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { resolveToolDisplay } from '@/lib/copilot/tools/client/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-call-state'
import type { ContentBlock, MothershipResource, OptionItem, ToolCallData } from '../../types'
import { SUBAGENT_LABELS, TOOL_UI_METADATA } from '../../types'
import type { AgentGroupItem } from './components'
import {
  AgentGroup,
  ChatContent,
  CircleStop,
  Options,
  PendingTagIndicator,
  ThinkingBlock,
} from './components'

const FILE_SUBAGENT_ID = 'file'

interface TextSegment {
  type: 'text'
  content: string
}

interface ThinkingSegment {
  type: 'thinking'
  id: string
  content: string
  startedAt?: number
  endedAt?: number
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

type MessageSegment =
  | TextSegment
  | ThinkingSegment
  | AgentGroupSegment
  | OptionsSegment
  | StoppedSegment

const SUBAGENT_KEYS = new Set(Object.keys(SUBAGENT_LABELS))

/**
 * Maps subagent names to the Mothership tool that dispatches them when the
 * tool name differs from the subagent name (e.g. `workspace_file` → `file`).
 * When a `subagent` block arrives, any trailing dispatch tool in the previous
 * group is absorbed so it doesn't render as a separate Mothership entry.
 */
const SUBAGENT_DISPATCH_TOOLS: Record<string, string> = {
  [FILE_SUBAGENT_ID]: WorkspaceFile.id,
}

function isToolResultRead(params?: Record<string, unknown>): boolean {
  const path = params?.path
  return typeof path === 'string' && path.startsWith('internal/tool-results/')
}

function formatToolName(name: string): string {
  return name
    .replace(/_v\d+$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function resolveAgentLabel(key: string): string {
  return SUBAGENT_LABELS[key] ?? formatToolName(key)
}

function isToolDone(status: ToolCallData['status']): boolean {
  return (
    status === 'success' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'rejected'
  )
}

function isDelegatingTool(tc: NonNullable<ContentBlock['toolCall']>): boolean {
  return tc.status === 'executing'
}

function mapToolStatusToClientState(
  status: ContentBlock['toolCall'] extends { status: infer T } ? T : string
) {
  switch (status) {
    case 'success':
      return ClientToolCallState.success
    case 'error':
      return ClientToolCallState.error
    case 'cancelled':
      return ClientToolCallState.cancelled
    case 'skipped':
      return ClientToolCallState.aborted
    case 'rejected':
      return ClientToolCallState.rejected
    default:
      return ClientToolCallState.executing
  }
}

function getOverrideDisplayTitle(tc: NonNullable<ContentBlock['toolCall']>): string | undefined {
  if (tc.name === ReadTool.id || tc.name === 'respond' || tc.name.endsWith('_respond')) {
    return resolveToolDisplay(tc.name, mapToolStatusToClientState(tc.status), tc.params)?.text
  }
  return undefined
}

function toToolData(tc: NonNullable<ContentBlock['toolCall']>): ToolCallData {
  const overrideDisplayTitle = getOverrideDisplayTitle(tc)
  const displayTitle =
    overrideDisplayTitle ||
    tc.displayTitle ||
    TOOL_UI_METADATA[tc.name as keyof typeof TOOL_UI_METADATA]?.title ||
    formatToolName(tc.name)

  return {
    id: tc.id,
    toolName: tc.name,
    displayTitle,
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
  const groupsByKey = new Map<string, AgentGroupSegment>()
  let activeGroupKey: string | null = null

  const groupKey = (name: string, parentToolCallId: string | undefined) =>
    parentToolCallId ? `${name}:${parentToolCallId}` : `${name}:legacy`

  const resolveGroupKey = (name: string, parentToolCallId: string | undefined) => {
    if (parentToolCallId) return groupKey(name, parentToolCallId)
    if (activeGroupKey && groupsByKey.get(activeGroupKey)?.agentName === name) {
      return activeGroupKey
    }
    for (const [key, g] of groupsByKey) {
      if (g.agentName === name && g.isOpen) return key
    }
    return groupKey(name, undefined)
  }

  const ensureGroup = (
    name: string,
    parentToolCallId: string | undefined
  ): { group: AgentGroupSegment; created: boolean } => {
    const key = resolveGroupKey(name, parentToolCallId)
    const existing = groupsByKey.get(key)
    if (existing) return { group: existing, created: false }
    const group: AgentGroupSegment = {
      type: 'agent_group',
      id: `agent-${key}-${segments.length}`,
      agentName: name,
      agentLabel: resolveAgentLabel(name),
      items: [],
      isDelegating: false,
      isOpen: false,
    }
    segments.push(group)
    groupsByKey.set(key, group)
    return { group, created: true }
  }

  const findGroupForSubagentChunk = (
    parentToolCallId: string | undefined
  ): AgentGroupSegment | undefined => {
    if (parentToolCallId) {
      for (const [key, g] of groupsByKey) {
        if (key.endsWith(`:${parentToolCallId}`)) return g
      }
      return undefined
    }
    if (activeGroupKey) return groupsByKey.get(activeGroupKey)
    return undefined
  }

  const flushLanes = () => {
    for (const g of groupsByKey.values()) {
      g.isOpen = false
      g.isDelegating = false
    }
    groupsByKey.clear()
    activeGroupKey = null
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'subagent_text' || block.type === 'subagent_thinking') {
      if (!block.content) continue
      const g = findGroupForSubagentChunk(block.parentToolCallId)
      if (!g) continue
      g.isDelegating = false
      const lastItem = g.items[g.items.length - 1]
      if (lastItem?.type === 'text') {
        lastItem.content += block.content
      } else {
        g.items.push({ type: 'text', content: block.content })
      }
      continue
    }

    if (block.type === 'thinking') {
      if (!block.content?.trim()) continue
      flushLanes()
      const last = segments[segments.length - 1]
      if (last?.type === 'thinking' && last.endedAt === undefined) {
        last.content += block.content
        if (block.endedAt !== undefined) last.endedAt = block.endedAt
      } else {
        segments.push({
          type: 'thinking',
          id: `thinking-${i}`,
          content: block.content,
          startedAt: block.timestamp,
          endedAt: block.endedAt,
        })
      }
      continue
    }

    if (block.type === 'text') {
      if (!block.content) continue
      if (block.subagent) {
        const g = groupsByKey.get(resolveGroupKey(block.subagent, block.parentToolCallId))
        if (g) {
          g.isDelegating = false
          const lastItem = g.items[g.items.length - 1]
          if (lastItem?.type === 'text') {
            lastItem.content += block.content
          } else {
            g.items.push({ type: 'text', content: block.content })
          }
          continue
        }
      }
      flushLanes()
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
      let inheritedDelegation = false
      const dispatchToolName = SUBAGENT_DISPATCH_TOOLS[key]
      if (dispatchToolName) {
        const mship = groupsByKey.get(groupKey('mothership', undefined))
        if (mship) {
          const last = mship.items[mship.items.length - 1]
          if (last?.type === 'tool' && last.data.toolName === dispatchToolName) {
            inheritedDelegation = !isToolDone(last.data.status) && Boolean(last.data.streamingArgs)
            mship.items.pop()
          }
        }
      }
      groupsByKey.delete(groupKey('mothership', undefined))
      const { group: g } = ensureGroup(key, block.parentToolCallId)
      if (inheritedDelegation) g.isDelegating = true
      g.isOpen = true
      activeGroupKey = resolveGroupKey(key, block.parentToolCallId)
      continue
    }

    if (block.type === 'tool_call') {
      if (!block.toolCall) continue
      const tc = block.toolCall
      if (tc.name === ToolSearchToolRegex.id) continue
      if (tc.name === ReadTool.id && isToolResultRead(tc.params)) continue
      const isDispatch = SUBAGENT_KEYS.has(tc.name) && !tc.calledBy

      if (isDispatch) {
        groupsByKey.delete(groupKey('mothership', undefined))
        const { group: g } = ensureGroup(tc.name, tc.id)
        g.isDelegating = isDelegatingTool(tc)
        g.isOpen = g.isDelegating
        continue
      }

      const tool = toToolData(tc)

      if (tc.calledBy) {
        const { group: g, created } = ensureGroup(tc.calledBy, block.parentToolCallId)
        g.isDelegating = false
        if (created && block.parentToolCallId) g.isOpen = true
        g.items.push({ type: 'tool', data: tool })
        activeGroupKey = resolveGroupKey(tc.calledBy, block.parentToolCallId)
      } else {
        const { group: g } = ensureGroup('mothership', undefined)
        g.items.push({ type: 'tool', data: tool })
      }
      continue
    }

    if (block.type === 'options') {
      if (!block.options?.length) continue
      flushLanes()
      segments.push({ type: 'options', items: block.options })
      continue
    }

    if (block.type === 'subagent_end') {
      if (block.parentToolCallId) {
        for (const [key, g] of groupsByKey) {
          if (key.endsWith(`:${block.parentToolCallId}`)) {
            g.isOpen = false
            g.isDelegating = false
          }
        }
        if (activeGroupKey?.endsWith(`:${block.parentToolCallId}`)) {
          activeGroupKey = null
        }
      } else {
        for (const [key, g] of groupsByKey) {
          if (key.endsWith(':legacy') && g.agentName !== 'mothership') {
            g.isOpen = false
            g.isDelegating = false
          }
        }
        if (activeGroupKey?.endsWith(':legacy')) {
          activeGroupKey = null
        }
      }
      continue
    }

    if (block.type === 'stopped') {
      flushLanes()
      segments.push({ type: 'stopped' })
    }
  }

  const visibleSegments = segments.filter(
    (segment) =>
      segment.type !== 'agent_group' ||
      segment.items.length > 0 ||
      segment.isDelegating ||
      segment.isOpen
  )

  return visibleSegments
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
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
}

export function MessageContent({
  blocks,
  fallbackContent,
  isStreaming = false,
  onOptionSelect,
  onWorkspaceResourceSelect,
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
        <div className='space-y-[10px]'>
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
    isStreaming &&
    !hasTrailingContent &&
    (lastSegment.type === 'thinking' || hasSubagentEnded || allLastGroupToolsDone)

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
                onWorkspaceResourceSelect={onWorkspaceResourceSelect}
              />
            )
          case 'thinking': {
            const isActive =
              isStreaming && i === segments.length - 1 && segment.endedAt === undefined
            const elapsedMs =
              segment.startedAt !== undefined && segment.endedAt !== undefined
                ? segment.endedAt - segment.startedAt
                : undefined
            // Hide completed thinking that took 3s or less — quick thinking
            // isn't worth the visual noise. Still show while active (unknown
            // duration yet) and still show when timing is missing (old
            // persisted blocks) so we don't drop historical content.
            if (elapsedMs !== undefined && elapsedMs <= 3000) return null
            return (
              <div key={segment.id} className={isStreaming ? 'animate-stream-fade-in' : undefined}>
                <ThinkingBlock
                  content={segment.content}
                  isActive={isActive}
                  isStreaming={isStreaming}
                  startedAt={segment.startedAt}
                  endedAt={segment.endedAt}
                />
              </div>
            )
          }
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
                  isStreaming={isStreaming}
                  autoCollapse={!segment.isOpen && allToolsDone && hasFollowingText}
                  defaultExpanded={segment.isOpen}
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
