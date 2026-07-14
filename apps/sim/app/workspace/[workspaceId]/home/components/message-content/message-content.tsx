'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
const STREAM_IDLE_DELAY_MS = 1_500

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
  if (tc.name === 'manage_credential' && tc.params?.operation === 'rename') {
    const output = tc.result?.output
    const result = output && typeof output === 'object' ? (output as Record<string, unknown>) : null
    const previousDisplayName = result?.previousDisplayName
    if (typeof previousDisplayName === 'string' && previousDisplayName.trim()) {
      return getToolDisplayTitle(tc.name, {
        ...tc.params,
        previousDisplayName: previousDisplayName.trim(),
      })
    }
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

function appendThinkingItem(group: AgentGroupSegment, content: string): void {
  const lastItem = group.items[group.items.length - 1]
  if (lastItem?.type === 'thinking') {
    lastItem.content += content
  } else {
    group.items.push({ type: 'thinking', content })
  }
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

    // Main-agent thinking is not rendered — a display-only omission; the
    // reasoning is still reduced upstream (and stripped at persistence).
    if (block.type === 'thinking') continue

    // Subagent thinking renders in the lane as muted reasoning prose so a long
    // thinking round (extended thinking after a tool result can run for
    // minutes) reads as visible progress instead of a hung spinner. It does
    // NOT clear isDelegating: the header spinner keeps signaling activity
    // until real output or a tool arrives.
    if (block.type === 'subagent_thinking') {
      if (!block.content?.trim() || !block.spanId) continue
      let g = groupsBySpanId.get(block.spanId)
      // Out-of-order safety: see subagent_text branch below.
      if (!g && block.subagent) {
        g = ensureSpanGroup(block.subagent, block.spanId, block.parentSpanId)
      }
      if (!g) continue
      appendThinkingItem(g, block.content)
      continue
    }

    if (block.type === 'subagent_text') {
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
      // here. It is cleared in the subagent_text, scoped text, tool_call, and
      // subagent_end branches (thinking renders but keeps the spinner).
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
  // Run-ordinal keys, mirroring parseBlocksWithSpanTree. A turn starts in this
  // parser and flips to the span-tree parser when the first spanId-carrying
  // block arrives; segments that exist in both must keep the SAME React key
  // across that flip or their subtrees remount mid-stream (group re-expands,
  // text re-fades). Block-index text keys and position-based mothership ids
  // diverge from the span-tree scheme; run ordinals match it.
  let textRun = 0
  let mothershipRun = 0

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
      // same React key and never remounts. The mothership group uses the same
      // run-ordinal id as the span-tree parser for the same reason. Orphans
      // (no dispatch tool, not mothership) keep the position-based legacy id.
      id: parentToolCallId
        ? `agent-${parentToolCallId}`
        : name === 'mothership'
          ? `agent-mothership-${mothershipRun++}`
          : `agent-${key}-${segments.length}`,
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

    // Subagent thinking renders in the lane as muted reasoning prose (same
    // rationale as the span-tree parser); it keeps the delegating spinner.
    if (block.type === 'subagent_thinking') {
      if (!block.content?.trim()) continue
      const g = findGroupForSubagentChunk(block.parentToolCallId)
      if (!g) continue
      const lastItem = g.items[g.items.length - 1]
      if (lastItem?.type === 'thinking') {
        lastItem.content += block.content
      } else {
        g.items.push({ type: 'thinking', content: block.content })
      }
      continue
    }

    if (block.type === 'subagent_text') {
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
      // Main-agent thinking is not rendered. It still breaks open SUBAGENT
      // lanes so later chunks don't merge across them, but it must not
      // fracture the top-level (mothership) tool run: models stream reasoning
      // between consecutive tool rounds (Anthropic thinking, OpenAI per-round
      // summaries), and splitting on it renders back-to-back top-level tools
      // as separate groups. Thinking is also stripped at persistence, so a
      // live split would disagree with the reloaded transcript. Every other
      // segment kind still breaks the run via its own branch.
      if (!block.content?.trim()) continue
      const mothershipKey = groupKey('mothership', undefined)
      const mothership = groupsByKey.get(mothershipKey)
      if (mothership) groupsByKey.delete(mothershipKey)
      flushLanes()
      if (mothership) groupsByKey.set(mothershipKey, mothership)
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
        segments.push({ type: 'text', id: `text-${textRun++}`, content: block.content })
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

/**
 * True while any wire-declared work in the turn is still running: a tool row
 * still `executing`, or a subagent lane that has not closed. A lane closes via
 * its paired `subagent_end` block (live serializer) or a stamped `endedAt`
 * (Sim-backend persistence / turn-terminal sweep). The live path never stamps
 * `endedAt` on `subagent` blocks, so checking `endedAt` alone reads every
 * finished subagent as still running for the rest of the turn — permanently
 * suppressing the between-steps thinking indicator after the first delegation.
 */
export function assistantMessageHasRunningWork(blocks: ContentBlock[]): boolean {
  const closedSpanIds = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'subagent_end' && block.spanId) closedSpanIds.add(block.spanId)
  }
  return blocks.some(
    (block) =>
      block.toolCall?.status === 'executing' ||
      (block.type === 'subagent' &&
        block.endedAt === undefined &&
        !(block.spanId && closedSpanIds.has(block.spanId)))
  )
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

export function shouldShowTrailingThinking({
  isStreaming,
  isStreamIdle,
  isRenderingStream,
  hasExecutingTool,
  lastSegmentType,
}: {
  isStreaming: boolean
  isStreamIdle: boolean
  isRenderingStream: boolean
  hasExecutingTool: boolean
  lastSegmentType?: 'text' | 'agent_group' | 'options' | 'stopped'
}): boolean {
  return (
    isStreaming &&
    isStreamIdle &&
    !isRenderingStream &&
    !hasExecutingTool &&
    lastSegmentType !== 'stopped'
  )
}

interface MessageContentProps {
  blocks: ContentBlock[]
  fallbackContent: string
  isStreaming: boolean
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  onOptionSelect?: (id: string) => void
  onPhaseChange?: (phase: MessagePhase) => void
}

function MessageContentInner({
  blocks,
  fallbackContent,
  isStreaming = false,
  questionAnswers,
  onOptionSelect,
  onPhaseChange,
}: MessageContentProps) {
  const { onWorkspaceResourceSelect } = useChatSurface()
  const parsed = useMemo(() => (blocks.length > 0 ? parseBlocks(blocks) : []), [blocks])

  const [trailingRevealing, setTrailingRevealing] = useState(false)
  const handleTrailingRevealChange = useCallback((revealing: boolean) => {
    setTrailingRevealing(revealing)
  }, [])
  const [trailingStreamActivity, setTrailingStreamActivity] = useState(false)
  const handleTrailingStreamActivityChange = useCallback((active: boolean) => {
    setTrailingStreamActivity(active)
  }, [])
  const [isStreamIdle, setIsStreamIdle] = useState(false)

  // Every rendered stream snapshot restarts the quiet-period clock. A layout
  // effect clears an already-visible indicator before paint, so a chunk from
  // any parallel lane hides the one turn-level loader without a stale flash.
  useLayoutEffect(() => {
    if (!isStreaming) {
      setIsStreamIdle(false)
      return
    }

    setIsStreamIdle(false)
    const timeout = setTimeout(() => setIsStreamIdle(true), STREAM_IDLE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [blocks, fallbackContent, isStreaming])

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

  // Executing tools already render an active row. An open subagent lane does
  // not suppress the turn-level indicator: once its latest visible chunk has
  // settled, the loader can bridge the wait until that lane (or a parallel
  // sibling) emits again.
  const hasExecutingTool = blocks.some((b) => b.toolCall?.status === 'executing')
  const showTrailingThinking = shouldShowTrailingThinking({
    isStreaming: phase === 'streaming',
    isStreamIdle,
    isRenderingStream: trailingStreamActivity,
    hasExecutingTool,
    lastSegmentType: lastSegment.type,
  })

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
                questionAnswers={questionAnswers}
                onOptionSelect={onOptionSelect}
                onWorkspaceResourceSelect={onWorkspaceResourceSelect}
                onRevealStateChange={
                  i === segments.length - 1 ? handleTrailingRevealChange : undefined
                }
                onStreamActivityChange={
                  i === segments.length - 1 ? handleTrailingStreamActivityChange : undefined
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
      {showTrailingThinking && <PendingTagIndicator />}
    </div>
  )
}

export const MessageContent = memo(MessageContentInner)
