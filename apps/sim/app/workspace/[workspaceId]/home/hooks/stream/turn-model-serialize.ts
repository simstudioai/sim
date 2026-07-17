import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  resolveStreamingToolDisplayTitle,
  resolveToolDisplayTitle,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'
import {
  type AgentNode,
  createTurnModel,
  MAIN_SPAN,
  type NodeStatus,
  reduceEvent,
  type ToolNode,
  type TurnModel,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/**
 * Serialization bridge between the normalized {@link TurnModel} (the streaming
 * source of truth) and the persisted/rendered `ContentBlock[]` shape. The model
 * is authoritative during streaming; `flush` serializes it to blocks for the
 * React-Query/pending snapshot and the DB, and the renderer keeps projecting
 * blocks via the existing `parseBlocks`. `contentBlocksToModel` rebuilds the
 * model from a persisted snapshot so a reconnect mid-stream continues into the
 * exact same model.
 */

function nodeToToolStatus(status: NodeStatus): ToolCallStatus {
  if (status === 'running') return ToolCallStatus.executing
  return status
}

function toolStatusToNode(status: ToolCallStatus): NodeStatus {
  if (status === ToolCallStatus.executing) return 'running'
  if (status === ToolCallStatus.interrupted) return 'error'
  return status
}

/**
 * Resolves a tool row's display title with the same precedence the live handler
 * used: the streaming-args title wins while args stream, then the arg-derived
 * title, then the explicit `ui.title`.
 */
function toolDisplayTitle(node: ToolNode): string | undefined {
  const streamingTitle = node.streamingArgs
    ? resolveStreamingToolDisplayTitle(node.name, node.streamingArgs)
    : undefined
  return streamingTitle ?? resolveToolDisplayTitle(node.name, node.args) ?? node.uiTitle
}

interface SeqBlock {
  seq: number
  block: ContentBlock
}

/**
 * Serializes the model to ordered content blocks matching the live handler
 * shapes: main-lane blocks carry no `spanId`; subagent-lane blocks carry
 * `spanId`/`parentSpanId` (and `subagent` name for text). A terminated agent
 * emits a paired `subagent_end` at its end seq so the projection closes the lane
 * exactly as the live browser path did.
 */
export function modelToContentBlocks(model: TurnModel): ContentBlock[] {
  const entries: SeqBlock[] = []

  for (const id of model.order) {
    const node = model.nodes.get(id)
    if (!node) continue
    const isSub = node.spanId !== MAIN_SPAN
    const ownerAgent = isSub ? (model.nodes.get(node.spanId) as AgentNode | undefined) : undefined
    const spanFields = isSub
      ? {
          spanId: node.spanId,
          ...(ownerAgent ? { parentSpanId: ownerAgent.parentSpanId } : {}),
        }
      : {}

    if (node.kind === 'text') {
      if (!node.text) continue
      // Real wall-clock timing drives the thinking-duration UI ("Thought for Ns"
      // + the 3s active-suppression); fall back to seq when ts was unavailable.
      const timing = {
        timestamp: node.startedAtMs ?? node.seq,
        ...(node.endedAtMs !== undefined ? { endedAt: node.endedAtMs } : {}),
      }
      if (node.channel === 'thinking') {
        entries.push({
          seq: node.seq,
          block: isSub
            ? {
                type: 'subagent_thinking',
                content: node.text,
                ...(ownerAgent ? { subagent: ownerAgent.agentId } : {}),
                ...spanFields,
                ...timing,
              }
            : { type: 'thinking', content: node.text, ...timing },
        })
      } else {
        entries.push({
          seq: node.seq,
          block: isSub
            ? {
                type: 'text',
                content: node.text,
                ...(ownerAgent ? { subagent: ownerAgent.agentId } : {}),
                ...spanFields,
                ...timing,
              }
            : { type: 'text', content: node.text, ...timing },
        })
      }
      continue
    }

    if (node.kind === 'tool') {
      // Per-call hidden tools are tracked for side effects but never rendered.
      if (node.hidden) continue
      const displayTitle = toolDisplayTitle(node)
      entries.push({
        seq: node.seq,
        block: {
          type: 'tool_call',
          toolCall: {
            id: node.id,
            name: node.name,
            status: nodeToToolStatus(node.status),
            ...(displayTitle ? { displayTitle } : {}),
            ...(node.args ? { params: node.args } : {}),
            ...(node.streamingArgs ? { streamingArgs: node.streamingArgs } : {}),
            ...(node.result
              ? {
                  result: {
                    success: node.result.success,
                    ...(node.result.output !== undefined ? { output: node.result.output } : {}),
                    ...(node.result.error ? { error: node.result.error } : {}),
                  },
                }
              : {}),
            ...(isSub && ownerAgent ? { calledBy: ownerAgent.agentId } : {}),
          },
          ...spanFields,
          // Wall-clock when available (uniform with text); falls back to seq.
          timestamp: node.startedAtMs ?? node.seq,
        },
      })
      continue
    }

    // Agent node -> a `subagent` open block, plus a `subagent_end` at end seq.
    entries.push({
      seq: node.seq,
      block: {
        type: 'subagent',
        content: node.agentId,
        spanId: node.spanId,
        parentSpanId: node.parentSpanId,
        ...(node.triggerToolCallId ? { parentToolCallId: node.triggerToolCallId } : {}),
        timestamp: node.startedAtMs ?? node.seq,
      },
    })
    if (node.endSeq !== undefined) {
      entries.push({
        seq: node.endSeq,
        block: {
          type: 'subagent_end',
          spanId: node.spanId,
          parentSpanId: node.parentSpanId,
          ...(node.triggerToolCallId ? { parentToolCallId: node.triggerToolCallId } : {}),
          timestamp: node.endSeq,
        },
      })
    }
  }

  entries.sort((a, b) => a.seq - b.seq)
  return entries.map((e) => e.block)
}

/** Returns the assistant-channel text of the main lane, in order (snapshot `content`). */
export function modelMainText(model: TurnModel): string {
  let text = ''
  for (const id of model.order) {
    const node = model.nodes.get(id)
    if (node?.kind === 'text' && node.spanId === MAIN_SPAN && node.channel === 'assistant') {
      text += node.text
    }
  }
  return text
}

/**
 * Rebuilds a model from a persisted/live snapshot of content blocks. Used when a
 * reconnect resumes a stream whose model is not in memory (page reload mid-turn):
 * the snapshot is replayed as synthetic envelopes so subsequent live events fold
 * into the identical model. Operates on the live, span-carrying block shape.
 */
export function contentBlocksToModel(blocks: ContentBlock[]): TurnModel {
  const model = createTurnModel()
  let seq = 0
  const synth = (
    type: string,
    payload: Record<string, unknown>,
    scope?: Record<string, unknown>,
    tsMs?: number
  ): PersistedStreamEventEnvelope =>
    ({
      v: 1,
      seq: ++seq,
      // Carry the persisted wall-clock so the rebuilt model keeps real timing
      // (thinking duration / 3s suppression) across a reconnect rebuild.
      ts: tsMs !== undefined ? new Date(tsMs).toISOString() : '',
      stream: { streamId: '', cursor: String(seq) },
      type,
      payload,
      ...(scope ? { scope } : {}),
      // double-cast-allowed: synthetic replay envelope rebuilt from ContentBlocks for reduceEvent only; payloads are intentionally the minimal shape the reducer reads (no executor/mode), never provider-parsed or re-emitted on the wire
    }) as unknown as PersistedStreamEventEnvelope

  const scopeFor = (block: ContentBlock): Record<string, unknown> | undefined =>
    block.spanId
      ? {
          lane: 'subagent',
          spanId: block.spanId,
          ...(block.parentSpanId ? { parentSpanId: block.parentSpanId } : {}),
          ...(block.parentToolCallId ? { parentToolCallId: block.parentToolCallId } : {}),
          ...(block.subagent ? { agentId: block.subagent } : {}),
        }
      : undefined

  for (const block of blocks) {
    if (block.type === 'subagent') {
      reduceEvent(
        model,
        synth(
          'span',
          {
            kind: 'subagent',
            event: 'start',
            agent: block.content,
            data: block.parentToolCallId ? { tool_call_id: block.parentToolCallId } : {},
          },
          scopeFor(block),
          block.timestamp
        )
      )
      if (block.endedAt !== undefined) {
        reduceEvent(
          model,
          synth(
            'span',
            { kind: 'subagent', event: 'end', agent: block.content, data: {} },
            scopeFor(block),
            block.endedAt
          )
        )
      }
      continue
    }
    if (block.type === 'subagent_end') {
      reduceEvent(
        model,
        synth('span', { kind: 'subagent', event: 'end', agent: '', data: {} }, scopeFor(block))
      )
      continue
    }
    if (block.type === 'tool_call' && block.toolCall) {
      const tc = block.toolCall
      reduceEvent(
        model,
        synth(
          'tool',
          {
            phase: 'call',
            toolCallId: tc.id,
            toolName: tc.name,
            arguments: tc.params,
            // Preserve a server-provided title that isn't derivable from args.
            ...(tc.displayTitle ? { ui: { title: tc.displayTitle } } : {}),
          },
          scopeFor(block),
          block.timestamp
        )
      )
      if (tc.status !== ToolCallStatus.executing) {
        const node = toolStatusToNode(tc.status)
        reduceEvent(
          model,
          synth(
            'tool',
            {
              phase: 'result',
              toolCallId: tc.id,
              toolName: tc.name,
              success: node === 'success',
              status: node,
              output: tc.result?.output,
              // Carry the failure message so a reloaded failed tool keeps it.
              ...(tc.result?.error ? { error: tc.result.error } : {}),
            },
            scopeFor(block)
          )
        )
      }
      continue
    }
    if (block.type === 'text' || block.type === 'subagent_text') {
      if (block.content) {
        reduceEvent(
          model,
          synth(
            'text',
            { channel: 'assistant', text: block.content },
            scopeFor(block),
            block.timestamp
          )
        )
      }
      continue
    }
    if (block.type === 'thinking' || block.type === 'subagent_thinking') {
      if (block.content) {
        reduceEvent(
          model,
          synth(
            'text',
            { channel: 'thinking', text: block.content },
            scopeFor(block),
            block.timestamp
          )
        )
      }
    }
  }

  return model
}
