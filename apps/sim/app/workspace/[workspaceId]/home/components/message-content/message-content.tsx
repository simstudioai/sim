'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Read as ReadTool, WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { resolveToolDisplay } from '@/lib/copilot/tools/client/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-call-state'
import {
  getToolCompletedTitle,
  getToolDisplayTitle,
  humanizeToolName,
} from '@/lib/copilot/tools/tool-display'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import type { ContentBlock, OptionItem, ToolCallData } from '../../types'
import { SUBAGENT_LABELS } from '../../types'
import type { AgentGroupItem } from './components'
import { AgentGroup, ChatContent, CircleStop, Options, PendingTagIndicator } from './components'
import { deriveMessagePhase, isToolDone, type MessagePhase } from './utils'

const FILE_SUBAGENT_ID = 'file'

interface TextSegment {
  type: 'text'
  /** Stable per-run React key (see the counters in parseBlocksWithSpanTree). */
  id: string
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

function isHiddenToolCall(toolName: string | undefined): boolean {
  return isToolHiddenInUi(toolName)
}

function resolveAgentLabel(key: string): string {
  if (key === 'mothership') return 'Sim'
  return SUBAGENT_LABELS[key] ?? humanizeToolName(key)
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
  const resolvedTitle =
    overrideDisplayTitle || tc.displayTitle || getToolDisplayTitle(tc.name, tc.params)
  const displayTitle =
    tc.status === 'success'
      ? (getToolCompletedTitle(resolvedTitle) ?? resolvedTitle)
      : resolvedTitle

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

const SPAN_ROOT = 'main'

function createAgentGroupSegment(name: string, id: string): AgentGroupSegment {
  return {
    type: 'agent_group',
    id,
    agentName: name,
    agentLabel: resolveAgentLabel(name),
    items: [],
    isDelegating: false,
    isOpen: false,
  }
}

type NarrationChannel = 'thinking' | 'assistant'

/**
 * Appends narration content to a group, merging into the previous text item.
 * When a thinking run and a text run meet, their contents can glue together
 * without any whitespace at the seam. The merge repairs only that semantic
 * channel transition, and only at an unambiguous sentence boundary — trailing
 * punctuation meeting a fresh alphanumeric start. Same-channel continuations
 * (streamed chunks of one run, resume legs) are concatenated verbatim, so a
 * token split like `v2.` + `1` is never mutated. `lastChannelByGroup` is the
 * caller's per-parse tracker of each group's most recent narration channel.
 */
function appendTextItem(
  group: AgentGroupSegment,
  content: string,
  channel: NarrationChannel,
  lastChannelByGroup: Map<AgentGroupSegment, NarrationChannel>
): void {
  const lastItem = group.items[group.items.length - 1]
  if (lastItem?.type === 'text') {
    const isChannelSeam = lastChannelByGroup.get(group) !== channel
    const needsSpace =
      isChannelSeam && /[.!?;:]$/.test(lastItem.content) && /^[A-Za-z0-9]/.test(content)
    lastItem.content += (needsSpace ? ' ' : '') + content
  } else {
    group.items.push({ type: 'text', content })
  }
  lastChannelByGroup.set(group, channel)
}

/**
 * Deterministic span-identity grouping. Every subagent-scoped block carries the
 * stable `spanId` of the run that produced it and a `parentSpanId` linking it to
 * its caller. Groups are keyed by `spanId` and nested under their parent's group
 * via `parentSpanId`, producing a real tree (e.g. Deploy inside Workflow) with
 * no name/tool-call reverse lookups. Delegation tool_calls are absorbed — the
 * subagent span is the canonical representation of the nested agent.
 */
function parseBlocksWithSpanTree(blocks: ContentBlock[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  const groupsBySpanId = new Map<string, AgentGroupSegment>()
  const lastNarrationChannel = new Map<AgentGroupSegment, NarrationChannel>()
  // Stable per-run counters for React keys. The Nth top-level text run / Nth
  // mothership group keeps the same key across re-parses (text runs and groups
  // are append-only at the top level), so React never remounts the streaming
  // ChatContent / AgentGroup when later segments shift array position. Keying by
  // array index or block index is unstable (subagent_end interleaves, parallel
  // spans reorder), which caused the disappear/re-animate + parallel-subagent flash.
  let textRun = 0
  let mothershipRun = 0

  // Canonical subagent identity: the dispatch tool call id. It is stable across
  // the no-spanId (legacy parser) -> spanId (span-tree parser) transition and
  // across DB-load vs live, so the group's React key never changes when the
  // underlying span id is stamped — eliminating the remount/flash and keeping a
  // refreshed transcript byte-identical to the live stream.
  const spanAnchor = new Map<string, string>()
  for (const b of blocks) {
    if (b.type === 'subagent' && b.spanId && b.parentToolCallId) {
      spanAnchor.set(b.spanId, b.parentToolCallId)
    }
  }
  const spanGroupKey = (spanId: string): string => `agent-${spanAnchor.get(spanId) ?? spanId}`

  const tailMothershipGroup = (): AgentGroupSegment | null => {
    const last = segments[segments.length - 1]
    return last?.type === 'agent_group' && last.agentName === 'mothership' ? last : null
  }

  // Top-level (mothership) tool calls render in a collapsible group. Reuse that
  // group only while it is still the most recent segment so consecutive tools
  // stay together; once any other segment (main text, a spawned subagent,
  // thinking, etc.) breaks the run, the next tool opens a fresh group below it
  // instead of jumping back up into the original one. This keeps the mothership's
  // tools and prose interleaved in the order they actually happened.
  const ensureMothership = (): AgentGroupSegment => {
    const existing = tailMothershipGroup()
    if (existing) return existing
    const group = createAgentGroupSegment('mothership', `agent-mothership-${mothershipRun++}`)
    segments.push(group)
    return group
  }

  // When a subagent spawns, drop the dispatch tool that triggered it (e.g.
  // workspace_file -> file) from whichever container it landed in so it does not
  // render as a separate entry beside the agent group.
  const absorbDispatchTool = (toolName: string, parentSpanId: string | undefined): void => {
    const container =
      parentSpanId && parentSpanId !== SPAN_ROOT
        ? groupsBySpanId.get(parentSpanId)
        : tailMothershipGroup()
    if (!container) return
    const last = container.items[container.items.length - 1]
    if (last?.type === 'tool' && last.data.toolName === toolName) {
      container.items.pop()
    }
  }

  const attachSpanGroup = (group: AgentGroupSegment, parentSpanId: string | undefined): void => {
    if (parentSpanId && parentSpanId !== SPAN_ROOT) {
      const parent = groupsBySpanId.get(parentSpanId)
      if (parent) {
        parent.isDelegating = false
        parent.items.push({ type: 'agent_group', group })
        return
      }
    }
    segments.push(group)
  }

  const ensureSpanGroup = (
    name: string,
    spanId: string,
    parentSpanId: string | undefined
  ): AgentGroupSegment => {
    const existing = groupsBySpanId.get(spanId)
    if (existing) return existing
    // Key by the dispatch tool call id (canonical, parser-stable) when known,
    // falling back to the spanId for spans with no dispatch tool (legacy/orphan).
    const group = createAgentGroupSegment(name, spanGroupKey(spanId))
    groupsBySpanId.set(spanId, group)
    attachSpanGroup(group, parentSpanId)
    return group
  }

  const flushMainText = (content: string) => {
    const last = segments[segments.length - 1]
    if (last?.type === 'text') {
      last.content += content
    } else {
      segments.push({ type: 'text', id: `text-${textRun++}`, content })
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'subagent_text' || block.type === 'subagent_thinking') {
      if (!block.content || !block.spanId) continue
      let g = groupsBySpanId.get(block.spanId)
      // Out-of-order safety: content can arrive before its subagent-start block
      // (live streaming across resume legs). Create the span group on demand,
      // nested via parentSpanId, instead of dropping the content.
      if (!g && block.subagent) {
        g = ensureSpanGroup(block.subagent, block.spanId, block.parentSpanId)
      }
      if (!g) continue
      g.isDelegating = false
      appendTextItem(
        g,
        block.content,
        block.type === 'subagent_thinking' ? 'thinking' : 'assistant',
        lastNarrationChannel
      )
      continue
    }

    // Main-agent thinking is intentionally not rendered. The reasoning is still
    // reduced and persisted upstream — this is a display-only omission.
    if (block.type === 'thinking') continue

    if (block.type === 'text') {
      if (!block.content) continue
      if (block.subagent && block.spanId) {
        let g = groupsBySpanId.get(block.spanId)
        // Out-of-order safety: see subagent_text branch above.
        if (!g) g = ensureSpanGroup(block.subagent, block.spanId, block.parentSpanId)
        if (g) {
          g.isDelegating = false
          appendTextItem(g, block.content, 'assistant', lastNarrationChannel)
          continue
        }
      }
      flushMainText(block.content)
      continue
    }

    if (block.type === 'subagent') {
      if (!block.content || !block.spanId) continue
      // Absorb a trailing dispatch tool (e.g. workspace_file -> file) so it does
      // not render as a separate entry alongside the agent group.
      const dispatchToolName = SUBAGENT_DISPATCH_TOOLS[block.content]
      if (dispatchToolName) absorbDispatchTool(dispatchToolName, block.parentSpanId)
      const g = ensureSpanGroup(block.content, block.spanId, block.parentSpanId)
      if (block.endedAt !== undefined) {
        // Persisted backend path: the lane was stamped closed (endedAt) without
        // a separate subagent_end block (the Sim backend stamps endedAt only;
        // only the live browser path pushes subagent_end). Honor endedAt so a
        // reloaded transcript shows the subagent closed instead of a stuck
        // delegating spinner.
        g.isOpen = false
        g.isDelegating = false
        continue
      }
      // Show the working/delegating spinner from span open until the agent
      // emits its first content or tool (or ends). The legacy path derived this
      // from the dispatch tool_call, which the span path absorbs, so we set it
      // here. It is cleared in the subagent_text/subagent_thinking, scoped text,
      // tool_call, and subagent_end branches.
      g.isDelegating = true
      g.isOpen = true
      continue
    }

    if (block.type === 'tool_call') {
      if (!block.toolCall) continue
      const tc = block.toolCall
      if (isHiddenToolCall(tc.name)) continue
      if (tc.name === ReadTool.id && isToolResultRead(tc.params)) continue
      // Delegation tools are represented by their subagent span group; absorb.
      if (SUBAGENT_KEYS.has(tc.name)) continue
      const tool = toToolData(tc)
      if (block.spanId) {
        let g = groupsBySpanId.get(block.spanId)
        // Out-of-order safety: a subagent's tool can stream before its
        // subagent-start block (live streaming across resume legs). Create the
        // span group on demand (nested via parentSpanId) so the tool nests
        // under its agent instead of leaking to the top-level mothership flow.
        if (!g && tc.calledBy) {
          g = ensureSpanGroup(tc.calledBy, block.spanId, block.parentSpanId)
        }
        if (g) {
          g.isDelegating = false
          g.items.push({ type: 'tool', data: tool })
          continue
        }
      }
      ensureMothership().items.push({ type: 'tool', data: tool })
      continue
    }

    if (block.type === 'options') {
      if (!block.options?.length) continue
      segments.push({ type: 'options', items: block.options })
      continue
    }

    if (block.type === 'subagent_end') {
      if (block.spanId) {
        const g = groupsBySpanId.get(block.spanId)
        if (g) {
          g.isOpen = false
          g.isDelegating = false
        }
      }
      continue
    }

    if (block.type === 'stopped') {
      segments.push({ type: 'stopped' })
    }
  }

  // Recursively drop empty, closed, non-delegating nested groups so a subagent
  // that started and ended without emitting anything does not leave a stray
  // header row. The top-level filter below covers top-level groups.
  const pruneEmptyNested = (items: AgentGroupItem[]): AgentGroupItem[] =>
    items.filter((item) => {
      if (item.type !== 'agent_group') return true
      item.group.items = pruneEmptyNested(item.group.items)
      return item.group.items.length > 0 || item.group.isOpen || item.group.isDelegating
    })
  for (const segment of segments) {
    if (segment.type === 'agent_group') {
      segment.items = pruneEmptyNested(segment.items)
    }
  }

  return segments.filter(
    (segment) =>
      segment.type !== 'agent_group' ||
      segment.items.length > 0 ||
      segment.isDelegating ||
      segment.isOpen
  )
}

/**
 * Groups content blocks into agent-scoped segments.
 * Dispatch tool_calls (name matches a subagent key, no calledBy) are absorbed
 * into the agent header. Inner tool_calls are nested underneath their agent.
 * Orphan tool_calls (no calledBy, not a dispatch) group under "Sim".
 *
 * New backends stamp every subagent block with deterministic span identity; in
 * that case {@link parseBlocksWithSpanTree} builds a real nested tree. The
 * legacy flat heuristics below are retained for transcripts persisted before
 * span identity existed.
 */
export function parseBlocks(blocks: ContentBlock[]): MessageSegment[] {
  if (blocks.some((block) => Boolean(block.spanId))) {
    return parseBlocksWithSpanTree(blocks)
  }
  return parseBlocksLegacy(blocks)
}

function parseBlocksLegacy(blocks: ContentBlock[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  const groupsByKey = new Map<string, AgentGroupSegment>()
  const lastNarrationChannel = new Map<AgentGroupSegment, NarrationChannel>()
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
      // Canonical key = the dispatch tool call id, identical to the span-tree
      // parser, so a transcript that gains span ids (or a DB reload) keeps the
      // same React key and never remounts. Orphans (no dispatch tool) keep the
      // position-based legacy id.
      id: parentToolCallId ? `agent-${parentToolCallId}` : `agent-${key}-${segments.length}`,
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
      appendTextItem(
        g,
        block.content,
        block.type === 'subagent_thinking' ? 'thinking' : 'assistant',
        lastNarrationChannel
      )
      continue
    }

    if (block.type === 'thinking') {
      // Main-agent thinking is not rendered, but it still breaks open subagent
      // lanes so later chunks don't merge across it (display-only omission).
      if (!block.content?.trim()) continue
      flushLanes()
      continue
    }

    if (block.type === 'text') {
      if (!block.content) continue
      if (block.subagent) {
        const g = groupsByKey.get(resolveGroupKey(block.subagent, block.parentToolCallId))
        if (g) {
          g.isDelegating = false
          appendTextItem(g, block.content, 'assistant', lastNarrationChannel)
          continue
        }
      }
      flushLanes()
      const last = segments[segments.length - 1]
      if (last?.type === 'text') {
        last.content += block.content
      } else {
        segments.push({ type: 'text', id: `text-${i}`, content: block.content })
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
      if (isToolHiddenInUi(tc.name)) continue
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
        ? [{ type: 'text' as const, id: 'text-fallback', content: fallbackContent }]
        : []
  return segments.length > 0
}

export function shouldSmoothTextSegment({
  isStreaming,
  segmentIndex,
  segmentCount,
}: {
  isStreaming: boolean
  segmentIndex: number
  segmentCount: number
}): boolean {
  return isStreaming && segmentIndex === segmentCount - 1
}

interface MessageContentProps {
  blocks: ContentBlock[]
  fallbackContent: string
  isStreaming: boolean
  onOptionSelect?: (id: string) => void
  onPhaseChange?: (phase: MessagePhase) => void
}

function MessageContentInner({
  blocks,
  fallbackContent,
  isStreaming = false,
  onOptionSelect,
  onPhaseChange,
}: MessageContentProps) {
  const { onWorkspaceResourceSelect } = useChatSurface()
  const parsed = useMemo(() => (blocks.length > 0 ? parseBlocks(blocks) : []), [blocks])

  const [trailingRevealing, setTrailingRevealing] = useState(false)
  const handleTrailingRevealChange = useCallback((revealing: boolean) => {
    setTrailingRevealing(revealing)
  }, [])

  const segments: MessageSegment[] =
    parsed.length > 0
      ? parsed
      : fallbackContent?.trim()
        ? [{ type: 'text' as const, id: 'text-fallback', content: fallbackContent }]
        : []

  const lastSegment = segments[segments.length - 1]
  const hasTrailingTextSegment = lastSegment?.type === 'text'
  const isRevealing = hasTrailingTextSegment && trailingRevealing
  const phase = deriveMessagePhase({ isStreaming, isRevealing })

  const onPhaseChangeRef = useRef(onPhaseChange)
  onPhaseChangeRef.current = onPhaseChange
  useEffect(() => {
    onPhaseChangeRef.current?.(phase)
  }, [phase])

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

  const hasTrailingContent = lastSegment.type === 'text' || lastSegment.type === 'stopped'

  // Deterministic "between steps" signal: the turn is still streaming, nothing
  // is actively running (a running tool/subagent renders its own spinner), and
  // no trailing text is being revealed. Derived from explicit node state rather
  // than guessing from the shape of the last segment.
  const hasRunningWork = blocks.some(
    (b) => b.toolCall?.status === 'executing' || (b.type === 'subagent' && b.endedAt === undefined)
  )
  const showTrailingThinking = phase === 'streaming' && !hasTrailingContent && !hasRunningWork

  return (
    <div className='space-y-[10px]'>
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'text':
            return (
              <ChatContent
                key={segment.id}
                content={segment.content}
                isStreaming={shouldSmoothTextSegment({
                  isStreaming,
                  segmentIndex: i,
                  segmentCount: segments.length,
                })}
                onOptionSelect={onOptionSelect}
                onWorkspaceResourceSelect={onWorkspaceResourceSelect}
                onRevealStateChange={
                  i === segments.length - 1 ? handleTrailingRevealChange : undefined
                }
              />
            )
          case 'agent_group': {
            return (
              <div key={segment.id} className={isStreaming ? 'animate-stream-fade-in' : undefined}>
                <AgentGroup
                  key={segment.id}
                  agentName={segment.agentName}
                  agentLabel={segment.agentLabel}
                  items={segment.items}
                  isDelegating={segment.isDelegating}
                  isStreaming={isStreaming}
                  isCurrentSection={i === segments.length - 1}
                  isLaneOpen={segment.isOpen}
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
                <CircleStop className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='text-[14px] text-[var(--text-body)]'>Stopped by user</span>
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

export const MessageContent = memo(MessageContentInner)
