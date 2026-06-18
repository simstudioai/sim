import { resolveStreamToolOutcome } from '@/lib/copilot/chat/stream-tool-outcome'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1RunKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'

/**
 * The single deterministic model of one assistant turn, derived purely from the
 * Go wire stream. Every tool and subagent is a {@link LifecycleNode} with one
 * explicit terminal source, so rendering reads node status instead of inferring
 * it from transport, preview sessions, or a turn-complete sweep. Parallel
 * subagents are independent span lanes; nested subagents nest by `parentSpanId`.
 */

/** The root span lane id Go stamps on main-agent (non-subagent) events. */
export const MAIN_SPAN = 'main'

/**
 * Terminal-bearing status for a single node. `running` is the only
 * non-terminal value; everything else is read from an explicit wire terminal
 * (tool `result`, span `end`) or propagated from the turn terminal.
 */
export type NodeStatus = 'running' | 'success' | 'error' | 'cancelled' | 'skipped' | 'rejected'

/** Turn-level status. Terminal values come from the wire `complete`/`error`. */
export type TurnStatus = 'streaming' | 'complete' | 'error' | 'cancelled'

export type TextChannel = 'assistant' | 'thinking'

interface NodeBase {
  /** Stable node id. Tools use `toolCallId`; agents use `spanId`; text/synthetic use a derived id. */
  id: string
  /** The span lane this node belongs to (`MAIN_SPAN` for the main agent). */
  spanId: string
  /** Arrival order key (wire `seq`), monotonic within a turn. */
  seq: number
  /**
   * Wall-clock (wire `ts`) the node opened. Serialized as the block `timestamp`
   * so it always means epoch-ms (never the wire seq), driving duration UI and
   * surviving the reconnect round-trip. Absent only when `ts` was unavailable.
   */
  startedAtMs?: number
}

export interface ToolNode extends NodeBase {
  kind: 'tool'
  name: string
  status: NodeStatus
  args?: Record<string, unknown>
  streamingArgs?: string
  uiTitle?: string
  /** Per-call `ui.hidden` flag — the node is tracked for side effects but not rendered. */
  hidden?: boolean
  result?: { success: boolean; output?: unknown; error?: string }
}

export interface AgentNode extends NodeBase {
  kind: 'agent'
  /** Span lane of the run that invoked this one (`MAIN_SPAN` for a direct child). */
  parentSpanId: string
  /** Display id (e.g. `file`, `workflow`) — never a routing key (collides across siblings). */
  agentId: string
  /** The outer delegation tool_use that triggered this run; links the trigger tool node. */
  triggerToolCallId?: string
  status: NodeStatus
  /** Wire seq at which the run terminated (span end), for ordering the close marker. */
  endSeq?: number
}

export interface TextNode extends NodeBase {
  kind: 'text'
  channel: TextChannel
  text: string
  /** Wall-clock (wire `ts`) the segment was superseded by the next lane content. */
  endedAtMs?: number
}

export type LifecycleNode = ToolNode | AgentNode | TextNode

export interface TurnModel {
  status: TurnStatus
  /** All nodes by id. */
  nodes: Map<string, LifecycleNode>
  /** Node ids in arrival order — the projection orders within a lane by this. */
  order: string[]
  /** spanId -> agent node id (always equal to spanId). */
  agentBySpanId: Map<string, string>
  /** `${spanId}::${channel}` -> currently-open text node id (cleared on a lane break). */
  openTextByKey: Map<string, string>
  /**
   * Results that arrived before their tool `call` (out-of-order), keyed by
   * toolCallId. Raw `status`/`output` are kept so the outcome (incl. output-based
   * cancellation) resolves identically to the in-order path when drained.
   */
  bufferedResults: Map<
    string,
    { success: boolean; output?: unknown; status?: unknown; error?: string }
  >
  /**
   * Maps a tool call id to another tool node it folds into. Used for the
   * `edit_content` -> `workspace_file` row merge so the write streams into the
   * single "writing" row rather than a second row.
   */
  toolAlias: Map<string, string>
  /** Highest applied wire seq; events at or below are no-ops (cursor-idempotent replay). */
  lastSeq: number
}

export function createTurnModel(): TurnModel {
  return {
    status: 'streaming',
    nodes: new Map(),
    order: [],
    agentBySpanId: new Map(),
    openTextByKey: new Map(),
    bufferedResults: new Map(),
    toolAlias: new Map(),
    lastSeq: 0,
  }
}

const WORKSPACE_FILE_TOOL = 'workspace_file'
const EDIT_CONTENT_TOOL = 'edit_content'

/** Resolves a tool call id through the alias map (e.g. edit_content -> its workspace_file row). */
export function resolveToolId(model: TurnModel, id: string): string {
  return model.toolAlias.get(id) ?? id
}

/**
 * Finds the most recent `workspace_file` tool node in a span so an `edit_content`
 * write folds into it (the single "writing" row). Co-location in the file
 * subagent's span is the link — no coupling to preview phases. The caller
 * reopens whatever this returns, including an already-settled row (an edit after
 * a completed write is the same file operation continuing), which is the
 * intended single-row behavior, not the old preview-gated parent reuse.
 */
function findWorkspaceFileNodeInSpan(model: TurnModel, spanId: string): ToolNode | undefined {
  for (let i = model.order.length - 1; i >= 0; i--) {
    const node = model.nodes.get(model.order[i])
    if (node?.kind === 'tool' && node.spanId === spanId && node.name === WORKSPACE_FILE_TOOL) {
      return node
    }
  }
  return undefined
}

/**
 * The file agent writes a file as strictly sequential `workspace_file` +
 * `edit_content` section pairs, waiting for each to finish before the next. So
 * when a new section's `workspace_file` opens, any earlier `workspace_file` row
 * still `running` in the same span is a completed section whose closing
 * `edit_content` result was reordered or dropped — finalize it as success so its
 * "writing" spinner resolves when the next section starts, instead of lingering
 * until the turn-terminal sweep. A no-op on the happy path (prior rows already
 * settled on their own result).
 */
function finalizeStaleWorkspaceFiles(model: TurnModel, spanId: string): void {
  for (const id of model.order) {
    const node = model.nodes.get(id)
    if (
      node?.kind === 'tool' &&
      node.spanId === spanId &&
      node.name === WORKSPACE_FILE_TOOL &&
      node.status === 'running'
    ) {
      node.status = 'success'
      node.streamingArgs = undefined
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Reads a wire event payload as a generic record. The payload is a wide
 * discriminated union; the reducer accesses fields uniformly, so this narrows
 * through the `unknown`-typed {@link isRecord} guard rather than a double cast.
 */
function payloadRecord(payload: unknown): Record<string, unknown> {
  return isRecord(payload) ? payload : {}
}

/** Parses a wire `ts` to epoch ms, or undefined when absent/unparseable. */
function tsToMs(ts: unknown): number | undefined {
  if (typeof ts !== 'string' || ts === '') return undefined
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : undefined
}

const TERMINAL_NODE_STATUSES = new Set<NodeStatus>([
  'success',
  'error',
  'cancelled',
  'skipped',
  'rejected',
])

export function isNodeTerminal(status: NodeStatus): boolean {
  return TERMINAL_NODE_STATUSES.has(status)
}

/** Maps the wire turn-completion status to the status propagated to open nodes. */
function turnTerminalNodeStatus(turn: Exclude<TurnStatus, 'streaming'>): NodeStatus {
  if (turn === 'cancelled') return 'cancelled'
  if (turn === 'error') return 'error'
  return 'success'
}

/**
 * Builds the inline `<mothership-error>` tag rendered for a stream error. Kept
 * byte-identical to the prior `buildInlineErrorTag` so the error special-tag
 * parser renders it the same way.
 */
function buildMothershipErrorTag(payload: Record<string, unknown>): string {
  const message =
    asString(payload.displayMessage) ??
    asString(payload.message) ??
    asString(payload.error) ??
    'An unexpected error occurred'
  const provider = asString(payload.provider)
  const code = asString(payload.code)
  return `<mothership-error>${JSON.stringify({
    message,
    ...(code ? { code } : {}),
    ...(provider ? { provider } : {}),
  })}</mothership-error>`
}

/** Closes a span's open text segment for `channel`, stamping its end time. */
function closeOpenText(
  model: TurnModel,
  spanId: string,
  channel: TextChannel,
  atMs?: number
): void {
  const key = `${spanId}::${channel}`
  const nodeId = model.openTextByKey.get(key)
  if (!nodeId) return
  if (atMs !== undefined) {
    const node = model.nodes.get(nodeId)
    if (node?.kind === 'text' && node.endedAtMs === undefined) node.endedAtMs = atMs
  }
  model.openTextByKey.delete(key)
}

/** Drops any open text segments in a lane so the next text starts a fresh node. */
function breakLane(model: TurnModel, spanId: string, atMs?: number): void {
  closeOpenText(model, spanId, 'assistant', atMs)
  closeOpenText(model, spanId, 'thinking', atMs)
}

function appendText(
  model: TurnModel,
  spanId: string,
  channel: TextChannel,
  text: string,
  seq: number,
  atMs?: number
): void {
  if (!text) return
  const key = `${spanId}::${channel}`
  const openId = model.openTextByKey.get(key)
  const open = openId ? model.nodes.get(openId) : undefined
  if (open && open.kind === 'text') {
    open.text += text
    return
  }
  // A new segment supersedes the other channel's open text (e.g. the answer
  // starts after thinking), which bounds the thinking segment's duration.
  closeOpenText(model, spanId, channel === 'thinking' ? 'assistant' : 'thinking', atMs)
  const node: TextNode = {
    kind: 'text',
    id: `text:${seq}`,
    spanId,
    channel,
    text,
    seq,
    ...(atMs !== undefined ? { startedAtMs: atMs } : {}),
  }
  model.nodes.set(node.id, node)
  model.order.push(node.id)
  model.openTextByKey.set(key, node.id)
}

/**
 * Applies a result that raced ahead of its tool `call` (buffered under `fromId`)
 * onto `node`, then clears the buffer. Used by the normal call path and by the
 * edit_content -> workspace_file merge, where the buffer is keyed by the
 * edit_content id but folds into the workspace_file row.
 */
function drainBufferedResult(model: TurnModel, fromId: string, node: ToolNode): void {
  const buffered = model.bufferedResults.get(fromId)
  if (!buffered) return
  model.bufferedResults.delete(fromId)
  node.status = resolveStreamToolOutcome({
    status: asString(buffered.status),
    success: buffered.success,
    output: buffered.output,
  })
  node.result = {
    success: buffered.success,
    output: buffered.output,
    ...(buffered.error ? { error: buffered.error } : {}),
  }
  node.streamingArgs = undefined
}

function upsertToolNode(
  model: TurnModel,
  id: string,
  spanId: string,
  name: string,
  seq: number,
  atMs?: number
): ToolNode {
  const existing = model.nodes.get(id)
  if (existing && existing.kind === 'tool') {
    if (name && !existing.name) existing.name = name
    return existing
  }
  const node: ToolNode = {
    kind: 'tool',
    id,
    spanId,
    name,
    status: 'running',
    seq,
    ...(atMs !== undefined ? { startedAtMs: atMs } : {}),
  }
  model.nodes.set(id, node)
  model.order.push(id)
  // A tool starting (or any structural event) closes the current text run.
  breakLane(model, spanId, atMs)
  drainBufferedResult(model, id, node)
  return node
}

function applyToolResult(
  model: TurnModel,
  id: string,
  success: boolean,
  status: unknown,
  output: unknown,
  error: string | undefined
): void {
  const existing = model.nodes.get(id)
  if (existing && existing.kind === 'tool') {
    existing.status = resolveStreamToolOutcome({ status: asString(status), success, output })
    existing.result = { success, output, ...(error ? { error } : {}) }
    // The args have fully resolved; drop the partial stream so the title and
    // any re-serialization read the final args, not truncated streaming JSON.
    existing.streamingArgs = undefined
    return
  }
  // Result before call: buffer raw fields until the call materializes the node;
  // the outcome (incl. output-based cancellation) is resolved on drain.
  model.bufferedResults.set(id, { success, output, status, ...(error ? { error } : {}) })
}

/**
 * Materializes a subagent lane on first reference. Subagent-scoped content
 * (text/thinking/tool) can be reduced before its `subagent_start` under heavy
 * parallel bursts (many subagents streaming into one ordered channel); without
 * the owning `AgentNode` the serializer can't attribute the content, so it leaks
 * into the main lane and the subagent's thinking is dropped until the start
 * lands. The wire scope already carries the lane identity (Go tags every
 * forwarded subagent event with its agent id/span), so the lane is rebuilt
 * deterministically from the content event itself — the symmetric counterpart to
 * buffering a result before its call. The later `subagent_start` finds this node
 * and no-ops.
 */
function ensureSubagentLane(
  model: TurnModel,
  spanId: string,
  scope: { agentId?: string; parentSpanId?: string; parentToolCallId?: string } | undefined,
  seq: number,
  atMs?: number
): void {
  if (spanId === MAIN_SPAN || model.agentBySpanId.has(spanId)) return
  const node: AgentNode = {
    kind: 'agent',
    id: spanId,
    spanId,
    parentSpanId: scope?.parentSpanId ?? MAIN_SPAN,
    agentId: scope?.agentId ?? '',
    status: 'running',
    seq,
    ...(atMs !== undefined ? { startedAtMs: atMs } : {}),
    ...(scope?.parentToolCallId ? { triggerToolCallId: scope.parentToolCallId } : {}),
  }
  model.nodes.set(node.id, node)
  model.order.push(node.id)
  model.agentBySpanId.set(spanId, node.id)
}

/**
 * Folds one wire envelope into the model. Pure accumulator: it mutates and
 * returns the same `model` (the streaming hot path keeps one model per turn).
 * `seq` is the monotonic wire cursor — the contract guarantees it is always a
 * finite number — so it is the sole ordering and idempotency key: an event at
 * or below the applied high-water mark is a replay and no-ops (reconnect replay
 * over a populated model is a no-op; replay into a fresh model rebuilds the
 * identical tree).
 */
export function reduceEvent(model: TurnModel, envelope: PersistedStreamEventEnvelope): TurnModel {
  const seq = envelope.seq
  if (seq <= model.lastSeq) return model
  model.lastSeq = seq
  const tsMs = tsToMs(envelope.ts)
  const scope = envelope.scope
  const spanId = scope?.spanId ?? MAIN_SPAN

  switch (envelope.type) {
    case MothershipStreamV1EventType.text: {
      const payload = envelope.payload
      ensureSubagentLane(model, spanId, scope, seq, tsMs)
      appendText(model, spanId, payload.channel as TextChannel, payload.text, seq, tsMs)
      break
    }
    case MothershipStreamV1EventType.tool: {
      const payload = payloadRecord(envelope.payload)
      // Preview phases are a separate panel concern (decoupled from tool status).
      if ('previewPhase' in payload) break
      const rawToolCallId = asString(payload.toolCallId)
      if (!rawToolCallId) break
      const toolName = asString(payload.toolName) ?? ''
      ensureSubagentLane(model, spanId, scope, seq, tsMs)
      const phase = payload.phase
      if (phase === MothershipStreamV1ToolPhase.call) {
        // edit_content folds into its span's workspace_file row (the write
        // continues in the single "writing" row), reopening it for the edit.
        if (toolName === EDIT_CONTENT_TOOL) {
          // A re-emitted edit_content call (same tool call id — duplicate/replay)
          // must keep its ORIGINAL target row. Re-running the span lookup can
          // return a newer workspace_file, and folding into that would leave the
          // first (already reopened) row running with no result ever closing it —
          // a spinner stuck until the turn-terminal sweep. So once aliased, reuse.
          const aliasedId = model.toolAlias.get(rawToolCallId)
          const aliasedParent = aliasedId ? model.nodes.get(aliasedId) : undefined
          const parent =
            aliasedParent?.kind === 'tool'
              ? aliasedParent
              : findWorkspaceFileNodeInSpan(model, spanId)
          if (parent) {
            model.toolAlias.set(rawToolCallId, parent.id)
            parent.status = 'running'
            parent.result = undefined
            // A result that raced ahead of this call was buffered under the
            // edit_content id; fold it into the reopened workspace_file row.
            drainBufferedResult(model, rawToolCallId, parent)
            break
          }
        }
        // A new file section opening settles any earlier still-running section row
        // in this span (the file agent writes sections sequentially).
        if (toolName === WORKSPACE_FILE_TOOL && !model.nodes.has(rawToolCallId)) {
          finalizeStaleWorkspaceFiles(model, spanId)
        }
        const node = upsertToolNode(
          model,
          resolveToolId(model, rawToolCallId),
          spanId,
          toolName,
          seq,
          tsMs
        )
        if (isRecord(payload.arguments)) node.args = payload.arguments
        // Tool-call titles are derived from the tool name (+args) at serialize
        // time; the stream only carries behavioral flags now.
        const ui = isRecord(payload.ui) ? payload.ui : undefined
        if (ui?.hidden === true) node.hidden = true
      } else if (phase === MothershipStreamV1ToolPhase.args_delta) {
        const node = upsertToolNode(
          model,
          resolveToolId(model, rawToolCallId),
          spanId,
          toolName,
          seq,
          tsMs
        )
        const delta = asString(payload.argumentsDelta)
        if (delta) node.streamingArgs = (node.streamingArgs ?? '') + delta
      } else if (phase === MothershipStreamV1ToolPhase.result) {
        applyToolResult(
          model,
          resolveToolId(model, rawToolCallId),
          payload.success === true,
          payload.status,
          payload.output,
          asString(payload.error)
        )
      }
      break
    }
    case MothershipStreamV1EventType.span: {
      const payload = envelope.payload
      if (payload.kind !== MothershipStreamV1SpanPayloadKind.subagent) break
      const data = isRecord(payload.data) ? payload.data : undefined
      const triggerToolCallId =
        scope?.parentToolCallId ?? asString(data?.tool_call_id) ?? asString(data?.toolCallId)
      const agentId = asString(payload.agent) ?? scope?.agentId ?? ''
      const resolvedSpanId =
        scope?.spanId ?? (triggerToolCallId ? `span:${triggerToolCallId}` : `span:${seq}`)
      const parentSpanId = scope?.parentSpanId ?? MAIN_SPAN

      if (payload.event === MothershipStreamV1SpanLifecycleEvent.start) {
        breakLane(model, parentSpanId, tsMs)
        const existingId = model.agentBySpanId.get(resolvedSpanId)
        if (existingId && model.nodes.has(existingId)) break
        const node: AgentNode = {
          kind: 'agent',
          id: resolvedSpanId,
          spanId: resolvedSpanId,
          parentSpanId,
          agentId,
          status: 'running',
          seq: seq,
          ...(tsMs !== undefined ? { startedAtMs: tsMs } : {}),
          ...(triggerToolCallId ? { triggerToolCallId } : {}),
        }
        model.nodes.set(node.id, node)
        model.order.push(node.id)
        model.agentBySpanId.set(resolvedSpanId, node.id)
      } else if (payload.event === MothershipStreamV1SpanLifecycleEvent.end) {
        // A pending pause is not a terminal — the run resumes later.
        if (data?.pending === true) break
        breakLane(model, resolvedSpanId, tsMs)
        const node = model.nodes.get(resolvedSpanId)
        if (node && node.kind === 'agent' && !isNodeTerminal(node.status)) {
          node.status = data && asString(data.error) ? 'error' : 'success'
          node.endSeq = seq
        }
      }
      break
    }
    case MothershipStreamV1EventType.run: {
      const payload = payloadRecord(envelope.payload)
      const kind = payload.kind
      if (kind === MothershipStreamV1RunKind.compaction_start) {
        const node = upsertToolNode(
          model,
          `compaction:${seq}`,
          spanId,
          'context_compaction',
          seq,
          tsMs
        )
        node.uiTitle = 'Compacting context...'
      } else if (kind === MothershipStreamV1RunKind.compaction_done) {
        let finalized = false
        for (let i = model.order.length - 1; i >= 0; i--) {
          const node = model.nodes.get(model.order[i])
          if (
            node?.kind === 'tool' &&
            node.name === 'context_compaction' &&
            node.status === 'running'
          ) {
            node.status = 'success'
            node.uiTitle = 'Compacted context'
            finalized = true
            break
          }
        }
        if (!finalized) {
          const node = upsertToolNode(
            model,
            `compaction:${seq}`,
            spanId,
            'context_compaction',
            seq,
            tsMs
          )
          node.status = 'success'
          node.uiTitle = 'Compacted context'
        }
      }
      break
    }
    case MothershipStreamV1EventType.error: {
      // The error tag is content (rendered inline by the error special-tag); turn
      // termination on error is applied by the stream loop's terminal handling,
      // not here, so a non-fatal mid-stream error event never settles the turn.
      const tag = buildMothershipErrorTag(payloadRecord(envelope.payload))
      const key = `${spanId}::assistant`
      const openId = model.openTextByKey.get(key)
      const open = openId ? model.nodes.get(openId) : undefined
      if (open && open.kind === 'text') {
        if (!open.text.includes(tag)) {
          const prefix = open.text.length > 0 && !open.text.endsWith('\n') ? '\n' : ''
          open.text += prefix + tag
        }
      } else {
        appendText(model, spanId, 'assistant', tag, seq, tsMs)
      }
      break
    }
    case MothershipStreamV1EventType.complete: {
      const payload = payloadRecord(envelope.payload)
      // An async pause is not a turn terminal — the paused tools/subagents
      // legitimately stay open until a later resume leg completes them.
      const response = isRecord(payload.response) ? payload.response : undefined
      if (response && 'async_pause' in response) break
      const status = payload.status
      if (status === MothershipStreamV1CompletionStatus.cancelled) {
        applyTurnTerminal(model, 'cancelled')
      } else if (status === MothershipStreamV1CompletionStatus.error) {
        applyTurnTerminal(model, 'error')
      } else {
        applyTurnTerminal(model, 'complete')
      }
      break
    }
    default:
      break
  }
  return model
}

/**
 * Sets the turn terminal and propagates it to every still-running node. This is
 * the deterministic replacement for the old `interrupted` sweep: a clean
 * `complete` settles stragglers as `success` (the turn succeeded), a stop as
 * `cancelled`, an error as `error`. With explicit tool/span terminals there are
 * normally no stragglers, so this is the abort/disconnect safety net, not a
 * routine path.
 */
export function applyTurnTerminal(model: TurnModel, turn: Exclude<TurnStatus, 'streaming'>): void {
  model.status = turn
  const nodeStatus = turnTerminalNodeStatus(turn)
  for (const id of model.order) {
    const node = model.nodes.get(id)
    if (!node || node.kind === 'text') continue
    if (node.status === 'running') {
      node.status = nodeStatus
      // Close a straggler subagent lane (no explicit span end) so the serializer
      // emits its `subagent_end` and the group resolves — otherwise the
      // delegating spinner spins forever after a model-driven terminal
      // (error/disconnect), the bug the snapshot path closes via `endedAt`.
      if (node.kind === 'agent' && node.endSeq === undefined) {
        node.endSeq = model.lastSeq
      }
    }
  }
}
