import { describe, expect, it } from 'vitest'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import {
  type AgentNode,
  applyTurnTerminal,
  createTurnModel,
  MAIN_SPAN,
  reduceEvent,
  type ToolNode,
  type TurnModel,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'

interface Scope {
  lane: 'subagent'
  spanId?: string
  parentSpanId?: string
  parentToolCallId?: string
  agentId?: string
}

function envelope(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  scope?: Scope
): PersistedStreamEventEnvelope {
  return {
    v: 1,
    seq,
    ts: new Date(seq).toISOString(),
    stream: { streamId: 's1', cursor: String(seq) },
    type,
    payload,
    ...(scope ? { scope } : {}),
  } as unknown as PersistedStreamEventEnvelope
}

function toolCall(seq: number, id: string, name: string, scope?: Scope) {
  return envelope(seq, 'tool', { phase: 'call', toolCallId: id, toolName: name }, scope)
}

function toolResult(seq: number, id: string, success: boolean, status?: string, scope?: Scope) {
  return envelope(
    seq,
    'tool',
    { phase: 'result', toolCallId: id, toolName: 'x', success, ...(status ? { status } : {}) },
    scope
  )
}

function spanStart(
  seq: number,
  spanId: string,
  agent: string,
  parentToolCallId?: string,
  parentSpanId = MAIN_SPAN
) {
  return envelope(
    seq,
    'span',
    {
      kind: 'subagent',
      event: 'start',
      agent,
      data: parentToolCallId ? { tool_call_id: parentToolCallId } : {},
    },
    {
      lane: 'subagent',
      spanId,
      parentSpanId,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      agentId: agent,
    }
  )
}

function spanEnd(
  seq: number,
  spanId: string,
  agent: string,
  opts?: { error?: string; pending?: boolean }
) {
  return envelope(
    seq,
    'span',
    {
      kind: 'subagent',
      event: 'end',
      agent,
      data: {
        ...(opts?.error ? { error: opts.error } : {}),
        ...(opts?.pending ? { pending: true } : {}),
      },
    },
    { lane: 'subagent', spanId, agentId: agent }
  )
}

function complete(seq: number, status: 'complete' | 'cancelled' | 'error' = 'complete') {
  return envelope(seq, 'complete', { status })
}

function apply(events: PersistedStreamEventEnvelope[], model = createTurnModel()): TurnModel {
  for (const e of events) reduceEvent(model, e)
  return model
}

function tool(model: TurnModel, id: string): ToolNode {
  const node = model.nodes.get(id)
  expect(node?.kind).toBe('tool')
  return node as ToolNode
}

function agent(model: TurnModel, spanId: string): AgentNode {
  const node = model.nodes.get(spanId)
  expect(node?.kind).toBe('agent')
  return node as AgentNode
}

describe('reduceEvent — tool lifecycle', () => {
  it('buffers a result that arrives before its call, then applies it', () => {
    const m = apply([toolResult(1, 'tc-1', true), toolCall(2, 'tc-1', 'search')])
    expect(tool(m, 'tc-1').status).toBe('success')
  })

  it('resolves output-based cancellation (user_cancelled) as cancelled, not error', () => {
    const m = apply([
      toolCall(1, 'tc-1', 'search'),
      envelope(2, 'tool', {
        phase: 'result',
        toolCallId: 'tc-1',
        toolName: 'search',
        success: false,
        output: { reason: 'user_cancelled' },
      }),
    ])
    expect(tool(m, 'tc-1').status).toBe('cancelled')
  })
})

describe('reduceEvent — subagent lifecycle', () => {
  it('nests a child run under its parent by parentSpanId', () => {
    const m = apply([
      spanStart(1, 'S1', 'workflow', 'tc-wf'),
      spanStart(2, 'S2', 'deploy', 'tc-deploy', 'S1'),
      spanEnd(3, 'S2', 'deploy'),
      spanEnd(4, 'S1', 'workflow'),
    ])
    expect(agent(m, 'S2').parentSpanId).toBe('S1')
    expect(agent(m, 'S1').parentSpanId).toBe(MAIN_SPAN)
    expect(agent(m, 'S1').status).toBe('success')
    expect(agent(m, 'S2').status).toBe('success')
  })

  it('keeps two parallel same-name runs independent (no agentId collision)', () => {
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-a'),
      spanStart(2, 'S2', 'file', 'tc-b'),
      toolCall(3, 'wf-a', 'prepare_file_edit', { lane: 'subagent', spanId: 'S1' }),
      toolCall(4, 'wf-b', 'prepare_file_edit', { lane: 'subagent', spanId: 'S2' }),
      toolResult(5, 'wf-a', true),
      spanEnd(6, 'S1', 'file'),
      toolResult(7, 'wf-b', true),
      spanEnd(8, 'S2', 'file'),
    ])
    expect(agent(m, 'S1').triggerToolCallId).toBe('tc-a')
    expect(agent(m, 'S2').triggerToolCallId).toBe('tc-b')
    expect(tool(m, 'wf-a').spanId).toBe('S1')
    expect(tool(m, 'wf-b').spanId).toBe('S2')
    expect(agent(m, 'S1').status).toBe('success')
    expect(agent(m, 'S2').status).toBe('success')
  })
})

describe('reduceEvent — idempotency', () => {
  it('is a no-op for an already-applied seq (reconnect replay over a populated model)', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), toolResult(2, 'tc-1', true)])
    const before = JSON.stringify([...m.nodes])
    reduceEvent(m, toolCall(1, 'tc-1', 'search'))
    reduceEvent(m, toolResult(2, 'tc-1', true))
    expect(JSON.stringify([...m.nodes])).toBe(before)
    expect(m.order).toEqual(['tc-1'])
  })

  it('rebuilds the identical model when replayed into a fresh model', () => {
    const events = [
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf', 'prepare_file_edit', { lane: 'subagent', spanId: 'S1' }),
      toolResult(3, 'wf', true),
      spanEnd(4, 'S1', 'file'),
      complete(5),
    ]
    const live = apply(events)
    const replayed = apply(events, createTurnModel())
    expect([...replayed.nodes]).toEqual([...live.nodes])
    expect(replayed.order).toEqual(live.order)
    expect(replayed.status).toBe(live.status)
  })
})

describe('reduceEvent — apply_file_edit row merge', () => {
  it('folds an apply_file_edit result that raced ahead of its call into the merged row', () => {
    const sub: Scope = { lane: 'subagent', spanId: 'S1' }
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf-1', 'prepare_file_edit', sub),
      // Result for apply_file_edit arrives BEFORE its call (buffered under ec-1)...
      toolResult(3, 'ec-1', true, undefined, sub),
      // ...then the call lands and aliases ec-1 -> wf-1, draining the buffer.
      toolCall(4, 'ec-1', 'apply_file_edit', sub),
    ])
    expect(tool(m, 'wf-1').status).toBe('success')
    expect(tool(m, 'wf-1').result?.success).toBe(true)
    expect(m.bufferedResults.has('ec-1')).toBe(false)
  })
})

describe('reduceEvent — error tag + compaction coverage', () => {
  it('pairs concurrent compactions only within their scoped subagent spans', () => {
    const scopeA: Scope = {
      lane: 'subagent',
      spanId: 'S1',
      parentSpanId: MAIN_SPAN,
      parentToolCallId: 'tc-A',
      agentId: 'workflow',
    }
    const scopeB: Scope = {
      lane: 'subagent',
      spanId: 'S2',
      parentSpanId: MAIN_SPAN,
      parentToolCallId: 'tc-B',
      agentId: 'workflow',
    }
    const m = apply([
      envelope(1, 'run', { kind: 'compaction_start' }, scopeA),
      envelope(2, 'run', { kind: 'compaction_start' }, scopeB),
      envelope(3, 'run', { kind: 'compaction_done' }, scopeA),
    ])

    expect(agent(m, 'S1').agentId).toBe('workflow')
    expect(agent(m, 'S2').agentId).toBe('workflow')
    expect(tool(m, 'compaction:1')).toEqual(
      expect.objectContaining({
        spanId: 'S1',
        status: 'success',
        uiTitle: 'Summarizing context',
      })
    )
    expect(tool(m, 'compaction:2')).toEqual(
      expect.objectContaining({
        spanId: 'S2',
        status: 'running',
        uiTitle: 'Summarizing context',
      })
    )

    reduceEvent(m, envelope(4, 'run', { kind: 'compaction_done' }, scopeB))
    expect(tool(m, 'compaction:2').status).toBe('success')
  })
})

describe('turn-terminal propagation', () => {
  it('closes a straggler subagent lane (sets endSeq) so a model-driven terminal resolves the group', () => {
    // A file subagent opened but no span end arrived (mid-stream error/disconnect).
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf-1', 'prepare_file_edit', { lane: 'subagent', spanId: 'S1' }),
    ])
    expect(agent(m, 'S1').endSeq).toBeUndefined()
    applyTurnTerminal(m, 'error')
    expect(agent(m, 'S1').status).toBe('error')
    // endSeq must be stamped so the serializer emits subagent_end and the lane's
    // delegating spinner resolves instead of spinning forever.
    expect(agent(m, 'S1').endSeq).toBeDefined()
  })

  it('never reopens an already-terminal node', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), toolResult(2, 'tc-1', false)])
    applyTurnTerminal(m, 'complete')
    expect(tool(m, 'tc-1').status).toBe('error')
  })
})

describe('reduceEvent — span-start owner reconciliation', () => {
  it('corrects a nonempty mismatched provisional lane owner from the authoritative start', () => {
    const model = createTurnModel()
    // A content event races ahead of the span start; its scope names the
    // FORWARDING caller (superagent), not the lane's real owner.
    reduceEvent(
      model,
      envelope(
        1,
        'text',
        { channel: 'assistant', text: 'early chunk' },
        { lane: 'subagent', spanId: 'S1', agentId: 'superagent', parentToolCallId: 'd1' }
      )
    )
    reduceEvent(
      model,
      envelope(
        2,
        'span',
        { kind: 'subagent', event: 'start', agent: 'workflow', data: { tool_call_id: 'd1' } },
        { lane: 'subagent', spanId: 'S1', parentToolCallId: 'd1' }
      )
    )
    const laneId = model.agentBySpanId.get('S1')
    const lane = laneId ? model.nodes.get(laneId) : undefined
    if (!lane || lane.kind !== 'agent') throw new Error('expected agent lane for S1')
    expect((lane as AgentNode).agentId).toBe('workflow')
  })
})

describe('reduceEvent — span end settles stale lane tools', () => {
  const laneScope = { lane: 'subagent', spanId: 'S1', parentToolCallId: 'd1' } as Scope

  it('marks still-running tools success when their lane ends cleanly', () => {
    const model = apply([
      envelope(
        1,
        'span',
        { kind: 'subagent', event: 'start', agent: 'browser', data: { tool_call_id: 'd1' } },
        laneScope
      ),
      toolCall(2, 'click-1', 'browser_click', laneScope),
      // No result for click-1 — dropped/reordered past the lane end.
      envelope(
        3,
        'span',
        { kind: 'subagent', event: 'end', agent: 'browser', data: {} },
        laneScope
      ),
    ])

    const click = model.nodes.get('click-1')
    if (click?.kind !== 'tool') throw new Error('expected tool node')
    expect(click.status).toBe('success')

    const laneId = model.agentBySpanId.get('S1')
    const lane = laneId ? model.nodes.get(laneId) : undefined
    if (lane?.kind !== 'agent') throw new Error('expected agent lane')
    expect(lane.status).toBe('success')
  })

  it('leaves settled tools alone and lets a late result overwrite the settle', () => {
    const model = apply([
      envelope(
        1,
        'span',
        { kind: 'subagent', event: 'start', agent: 'browser', data: { tool_call_id: 'd1' } },
        laneScope
      ),
      toolCall(2, 'click-1', 'browser_click', laneScope),
      envelope(
        3,
        'span',
        { kind: 'subagent', event: 'end', agent: 'browser', data: {} },
        laneScope
      ),
      // Late result arrives after the settle — it must win.
      envelope(
        4,
        'tool',
        {
          phase: 'result',
          toolCallId: 'click-1',
          toolName: 'browser_click',
          success: false,
          error: 'nope',
        },
        laneScope
      ),
    ])

    const click = model.nodes.get('click-1')
    if (click?.kind !== 'tool') throw new Error('expected tool node')
    expect(click.status).toBe('error')
    expect(click.result?.error).toBe('nope')
  })
})
