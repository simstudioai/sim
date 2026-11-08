import { isPlainRecord } from '@sim/utils/object'
import type { ContentBlock, OptionItem, ToolCallData } from '@/lib/mothership/chat/types'
import { SUBAGENT_LABELS } from '@/lib/mothership/chat/types'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { PrepareFileEdit, Read as ReadTool } from '@/lib/mothership/generated/tool-catalog-v1'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'
import { readCallActivity } from '@/lib/mothership/tools/activity'
import { isToolHiddenInUi } from '@/lib/mothership/tools/client/hidden-tools'
import { resolveToolDisplay } from '@/lib/mothership/tools/client/store-utils'
import { ClientToolCallState } from '@/lib/mothership/tools/client/tool-call-state'
import {
  getToolDisplayTitle,
  getToolStatusDisplayTitle,
  humanizeToolName,
  normalizeToolActivityDescription,
} from '@/lib/mothership/tools/display'
import { isAgentGroupResolved } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { THINKING_LABEL } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-labels'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/tool-status'

const FILE_SUBAGENT_ID = 'file'

interface TextSegment {
  type: 'text'
  /** Stable per-run React key (see the counters in parseBlocksWithSpanTree). */
  id: string
  content: string
}

export interface AgentGroupSegment {
  activity?: ToolActivity
  error?: string
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

interface TaskSegment {
  type: 'task'
  task: TaskBlockInfo
}

export type MessageSegment =
  | TextSegment
  | AgentGroupSegment
  | OptionsSegment
  | StoppedSegment
  | TaskSegment

const SUBAGENT_KEYS = new Set(Object.keys(SUBAGENT_LABELS))

/**
 * Maps subagent names to the Mothership tool that dispatches them when the
 * tool name differs from the subagent name (e.g. `workspace_file` → `file`).
 * When a `subagent` block arrives, any trailing dispatch tool in the previous
 * group is absorbed so it doesn't render as a separate Mothership entry.
 */
const SUBAGENT_DISPATCH_TOOLS: Record<string, string> = {
  [FILE_SUBAGENT_ID]: PrepareFileEdit.id,
  // The worker's general subagent: the `task` tool row is the dispatch; the lane
  // (titled by the model) replaces it.
  task: 'task',
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
  const activityDescription = normalizeToolActivityDescription(tc.activityDescription)
  const overrideDisplayTitle = getOverrideDisplayTitle(tc)
  const resolvedTitle =
    overrideDisplayTitle || tc.displayTitle || getToolDisplayTitle(tc.name, tc.params)
  const displayTitle = getToolStatusDisplayTitle(
    resolvedTitle,
    tc.status,
    tc.name,
    activityDescription
  )

  return {
    id: tc.id,
    toolName: tc.name,
    displayTitle,
    activityDescription,
    status: tc.status,
    activity: tc.activity,
    params: tc.params,
    result: tc.result,
    streamingArgs: tc.streamingArgs,
    startedAt: tc.startedAtMs,
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

/**
 * Appends narration content to a group, merging into the previous text item.
 * Streamed chunks and resume legs are concatenated verbatim, so a token split
 * like `v2.` + `1` is never mutated.
 */
function appendTextItem(group: AgentGroupSegment, content: string): void {
  const lastItem = group.items[group.items.length - 1]
  if (lastItem?.type === 'text') {
    lastItem.content += content
  } else {
    group.items.push({ type: 'text', content })
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

  /**
   * Reuse only the latest main activity segment so tools remain interleaved
   * with prose and subagents in stream order.
   */
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
  const absorbDispatchTool = (
    toolName: string,
    parentSpanId: string | undefined,
    dispatchToolCallId?: string
  ): void => {
    const container =
      parentSpanId && parentSpanId !== SPAN_ROOT
        ? groupsBySpanId.get(parentSpanId)
        : tailMothershipGroup()
    if (!container) return
    // Prefer the precise id match anywhere in the container — parallel sibling
    // tools can push the dispatch row off the tail position.
    if (dispatchToolCallId) {
      const idx = container.items.findIndex(
        (it) => it.type === 'tool' && it.data.id === dispatchToolCallId
      )
      if (idx >= 0) {
        container.items.splice(idx, 1)
        return
      }
    }
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

    // Thinking is intentionally absent from the transcript. Ignore both lanes
    // so rollout-skewed or replayed streams cannot surface reasoning or affect
    // layout differently from the persisted message, which strips it.
    if (block.type === 'thinking' || block.type === 'subagent_thinking') continue

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
      appendTextItem(g, block.content)
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
          appendTextItem(g, block.content)
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
      if (dispatchToolName) {
        absorbDispatchTool(dispatchToolName, block.parentSpanId, block.parentToolCallId)
      }
      const g = ensureSpanGroup(block.content, block.spanId, block.parentSpanId)
      if (block.subagentName) g.agentLabel = block.subagentName
      if (block.error) g.error = block.error
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
      // subagent_end branches; suppressed thinking leaves it unchanged.
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

    if (block.type === 'task') {
      if (!block.task) continue
      segments.push({ type: 'task', task: block.task })
      continue
    }

    if (block.type === 'subagent_end') {
      if (block.spanId) {
        const g = groupsBySpanId.get(block.spanId)
        if (g) {
          if (block.error) g.error = block.error
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
      return (
        item.group.items.length > 0 ||
        item.group.isOpen ||
        item.group.isDelegating ||
        Boolean(item.group.error)
      )
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
      Boolean(segment.error) ||
      segment.isDelegating ||
      segment.isOpen
  )
}

/**
 * Activities follow transcript order; unfinished parallel calls share one
 * active group. Each finished activity keeps its own header and summary.
 */
function groupByActivity(segments: MessageSegment[], isStreaming: boolean): MessageSegment[] {
  const labels = new Map<string, ToolActivity>()
  return segments.flatMap((segment, index): MessageSegment[] => {
    if (segment.type !== 'agent_group' || segment.agentName !== 'mothership') return [segment]
    const isOpen = isStreaming && index === segments.length - 1
    const groups: AgentGroupSegment[] = []
    let current: AgentGroupSegment | undefined
    for (const item of segment.items) {
      const activity = item.type === 'tool' ? readCallActivity(item.data) : undefined
      if (activity) labels.set(activity.id, { ...labels.get(activity.id), ...activity })
      if (!current || (activity && activity.id !== current.activity?.id)) {
        current = {
          ...segment,
          isOpen: false,
          activity: activity ? labels.get(activity.id) : undefined,
          id:
            groups.length === 0
              ? segment.id
              : `${segment.id}-${item.type === 'tool' ? item.data.id : groups.length}`,
          items: [],
        }
        groups.push(current)
      } else if (activity) {
        current.activity = labels.get(activity.id)
      }
      current.items.push(item)
    }
    if (!current) return [segment]
    current.isOpen = isOpen
    const firstWorking = groups.findIndex((group) => !isAgentGroupResolved(group.items))
    if (firstWorking >= 0 && firstWorking < groups.length - 1) {
      const working = groups[firstWorking]
      return [
        ...groups.slice(0, firstWorking),
        { ...working, isOpen, items: groups.slice(firstWorking).flatMap((group) => group.items) },
      ]
    }
    return groups
  })
}

export function parseBlocks(blocks: ContentBlock[], isStreaming = false): MessageSegment[] {
  const watches = new Set(
    blocks.flatMap((block) => (block.type === 'task' && block.task ? [block.task.taskId] : []))
  )
  /** The durable watch row replaces its registration receipt, not other calls or failed attempts. */
  const visibleBlocks = blocks.filter((block) => {
    const tool = block.toolCall
    if (block.type !== 'tool_call' || tool?.name !== 'watch' || tool.status !== 'success')
      return true
    const output = tool.result?.output
    return (
      !isPlainRecord(output) || typeof output.taskId !== 'string' || !watches.has(output.taskId)
    )
  })
  return groupByActivity(
    blocks.some((block) => Boolean(block.spanId))
      ? parseBlocksWithSpanTree(visibleBlocks)
      : parseBlocksLegacy(visibleBlocks),
    isStreaming
  )
}

/** Returns independently rendered text segments, excluding agent groups and other UI segments. */
export function getOrchestratorMessageTextSegments(
  blocks: ContentBlock[],
  fallbackContent: string
): string[] {
  const parsed = blocks.length > 0 ? parseBlocks(blocks) : []
  if (parsed.length === 0) return [fallbackContent]

  return parsed.map((segment) => (segment.type === 'text' ? segment.content : '')).filter(Boolean)
}

/** Returns only top-level orchestrator text, excluding agent groups and other UI segments. */
export function getOrchestratorMessageText(
  blocks: ContentBlock[],
  fallbackContent: string
): string {
  return getOrchestratorMessageTextSegments(blocks, fallbackContent).join('\n\n')
}

function parseBlocksLegacy(blocks: ContentBlock[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  const groupsByKey = new Map<string, AgentGroupSegment>()
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

    // See the span-tree parser: thinking is neither visible nor allowed to
    // influence grouping because it is absent from persisted transcripts.
    if (block.type === 'thinking' || block.type === 'subagent_thinking') continue

    if (block.type === 'subagent_text') {
      if (!block.content) continue
      const g = findGroupForSubagentChunk(block.parentToolCallId)
      if (!g) continue
      g.isDelegating = false
      appendTextItem(g, block.content)
      continue
    }

    if (block.type === 'text') {
      if (!block.content) continue
      if (block.subagent) {
        const g = groupsByKey.get(resolveGroupKey(block.subagent, block.parentToolCallId))
        if (g) {
          g.isDelegating = false
          appendTextItem(g, block.content)
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
      if (block.subagentName) g.agentLabel = block.subagentName
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

    if (block.type === 'task') {
      if (!block.task) continue
      flushLanes()
      segments.push({ type: 'task', task: block.task })
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

const DISPATCH_TOOL_NAMES = new Set([...SUBAGENT_KEYS, ...Object.values(SUBAGENT_DISPATCH_TOOLS)])

/**
 * Activity phrase for the turn-level shimmer, derived from the most recent
 * stream block. The shimmer only shows in quiet gaps (see showShimmer), so the
 * phrase describes the wait, not the output: a stall after streamed text is
 * the agent deciding what's next — Thinking — never "Generating" (while text
 * actually generates the shimmer is hidden). Dispatching covers only the
 * dispatch call itself (whose tool row the parser absorbs). Empty agent lanes
 * share this indicator until a visible activity row takes over.
 */
export function deriveThinkingLabel(blocks: ContentBlock[]): string {
  const last = blocks[blocks.length - 1]
  switch (last?.type) {
    case 'subagent_end':
      return 'Returning'
    case 'tool_call':
      return last.toolCall && DISPATCH_TOOL_NAMES.has(last.toolCall.name)
        ? 'Dispatching'
        : THINKING_LABEL
    default:
      return THINKING_LABEL
  }
}
