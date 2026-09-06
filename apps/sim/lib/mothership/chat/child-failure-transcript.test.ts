/**
 * @vitest-environment node
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { toDisplayMessage } from '@/lib/mothership/chat/display-message'
import { buildEffectiveChatTranscript } from '@/lib/mothership/chat/effective-transcript'
import {
  buildPersistedAssistantMessage,
  normalizeMessage,
} from '@/lib/mothership/chat/persisted-message'
import type { MothershipStreamV1StreamScope } from '@/lib/mothership/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { handleSpanEvent } from '@/lib/mothership/request/handlers/span'
import { parsePersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import { parseBlocks } from '@/app/workspace/[workspaceId]/home/components/message-content/message-content'
import {
  createTurnModel,
  reduceEvent,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import {
  contentBlocksToModel,
  modelToContentBlocks,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model-serialize'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

const failure = 'The model reached its output limit before finishing the response.'
function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  scope?: MothershipStreamV1StreamScope
) {
  const parsed = parsePersistedStreamEventEnvelope({
    v: 1,
    seq,
    ts: new Date(seq * 1000).toISOString(),
    stream: { streamId: 'stream-1' },
    type,
    payload,
    ...(scope ? { scope } : {}),
  })
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.event
}
function childEvents(partial: boolean, nested: boolean) {
  const parentSpanId = nested ? 'parent' : 'main'
  const failed: MothershipStreamV1StreamScope = {
    lane: 'subagent',
    agentId: 'task',
    spanId: 'failed',
    parentSpanId,
    parentToolCallId: 'dispatch-failed',
  }
  const sibling: MothershipStreamV1StreamScope = {
    ...failed,
    spanId: 'sibling',
    parentToolCallId: 'dispatch-sibling',
  }
  const parent: MothershipStreamV1StreamScope = {
    ...failed,
    spanId: 'parent',
    parentSpanId: 'main',
    parentToolCallId: 'dispatch-parent',
  }
  const start = (seq: number, scope: MothershipStreamV1StreamScope, name: string) =>
    event(seq, 'span', { kind: 'subagent', event: 'start', agent: 'task', data: { name } }, scope)
  return [
    ...(nested ? [start(1, parent, 'Coordinator')] : []),
    event(
      2,
      'tool',
      { phase: 'call', toolName: 'task', toolCallId: 'dispatch-failed' },
      nested ? parent : undefined
    ),
    start(3, failed, 'Inspect report'),
    start(4, sibling, 'Check tables'),
    ...(partial
      ? [
          event(
            5,
            'text',
            { channel: 'assistant', text: 'Found two rows before interruption.' },
            failed
          ),
        ]
      : []),
    event(
      6,
      'span',
      { kind: 'subagent', event: 'end', agent: 'task', data: { error: failure } },
      failed
    ),
    event(7, 'text', { channel: 'assistant', text: 'Tables checked.' }, sibling),
    event(8, 'span', { kind: 'subagent', event: 'end', agent: 'task' }, sibling),
    event(
      9,
      'tool',
      {
        phase: 'result',
        toolName: 'task',
        toolCallId: 'dispatch-failed',
        result: { success: false, error: failure },
      },
      nested ? parent : undefined
    ),
    ...(nested
      ? [event(10, 'span', { kind: 'subagent', event: 'end', agent: 'task' }, parent)]
      : []),
    event(11, 'complete', { status: 'success' }),
  ]
}
function verify(blocks: ContentBlock[], nested: boolean, partial: boolean) {
  const restored = contentBlocksToModel(blocks)
  expect(restored.nodes.get('failed')).toMatchObject({
    status: 'error',
    error: failure,
    displayName: 'Inspect report',
  })
  expect(restored.nodes.get('sibling')).toMatchObject({
    status: 'success',
    displayName: 'Check tables',
  })
  const segments = parseBlocks(blocks)
  const groups = segments.flatMap((segment) => {
    if (segment.type !== 'agent_group') return []
    return nested
      ? segment.items.flatMap((item) => (item.type === 'agent_group' ? [item.group] : []))
      : [segment]
  })
  expect(groups).toHaveLength(2)
  expect(groups[0]).toMatchObject({
    agentLabel: 'Inspect report',
    error: failure,
    isOpen: false,
    isDelegating: false,
  })
  expect(groups[0].items).toHaveLength(partial ? 1 : 0)
  expect(groups[1]).toMatchObject({ agentLabel: 'Check tables', isOpen: false })
  expect(groups[1]).not.toHaveProperty('error')
}

describe('child failure transcript boundaries', () => {
  it.each([
    { partial: false, nested: false },
    { partial: true, nested: false },
    { partial: false, nested: true },
    { partial: true, nested: true },
  ])('retains child outcome and sibling isolation: %j', ({ partial, nested }) => {
    const events = childEvents(partial, nested)
    const model = createTurnModel()
    for (const frame of events) reduceEvent(model, frame)
    const liveBlocks = modelToContentBlocks(model)
    verify(liveBlocks, nested, partial)
    const saved = normalizeMessage({
      id: 'assistant',
      role: 'assistant',
      content: '',
      contentBlocks: liveBlocks,
    })
    verify(toDisplayMessage(saved).contentBlocks ?? [], nested, partial)
    const messages = buildEffectiveChatTranscript({
      messages: [
        normalizeMessage({ id: 'stream-1', role: 'user', content: 'Inspect the workspace' }),
      ],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        status: 'complete',
        previewSessions: [],
        events: events.map((frame) => ({ eventId: frame.seq, streamId: 'stream-1', event: frame })),
      },
    })
    const recovered = contentBlocksToModel(
      toDisplayMessage(normalizeMessage({ ...messages[1] })).contentBlocks ?? []
    )
    for (const frame of events) reduceEvent(recovered, frame)
    verify(modelToContentBlocks(recovered), nested, partial)
  })

  it('persists the handler outcome on its own span and reports failure in the trace', async () => {
    const context = createStreamingContext()
    const endSpan = vi.spyOn(context.trace, 'endSpan')
    for (const frame of childEvents(false, false)) {
      if (frame.type === 'span')
        await handleSpanEvent(
          frame,
          context,
          { userId: 'user-1', workspaceId: 'workspace-1', workflowId: '' },
          {}
        )
    }
    const persisted = buildPersistedAssistantMessage({
      success: true,
      content: '',
      contentBlocks: context.contentBlocks,
      toolCalls: [],
    })
    const blocks = toDisplayMessage(normalizeMessage({ ...persisted })).contentBlocks ?? []
    const restored = contentBlocksToModel(blocks)
    expect(restored.nodes.get('failed')).toMatchObject({ status: 'error', error: failure })
    expect(restored.nodes.get('sibling')).toMatchObject({ status: 'success' })
    expect(endSpan.mock.calls.map(([span, status]) => [span.attributes?.spanId, status])).toEqual([
      ['failed', 'error'],
      ['sibling', 'ok'],
    ])
    expect(context.errors).toEqual([])
    expect(context.streamComplete).toBe(false)
  })
  it('shows a failed empty child and its error without requiring expansion', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentGroup, {
        agentName: 'task',
        agentLabel: 'Inspect report',
        items: [],
        error: failure,
      })
    )
    expect(markup).toContain('Inspect report — Failed')
    expect(markup).toContain(failure)
    expect(markup).not.toContain('<button')
    const sibling = renderToStaticMarkup(
      createElement(AgentGroup, {
        agentName: 'task',
        agentLabel: 'Check tables',
        items: [{ type: 'text', content: 'Tables checked.' }],
      })
    )
    expect(sibling).not.toContain('Failed')
    expect(sibling).not.toContain(failure)
  })
})
