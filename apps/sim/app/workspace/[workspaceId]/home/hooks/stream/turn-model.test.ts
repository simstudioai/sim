/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  type AgentNode,
  applyTurnTerminal,
  createTurnModel,
  MAIN_SPAN,
  reduceEvent,
  type TextNode,
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

function textEvent(seq: number, channel: 'assistant' | 'thinking', text: string, scope?: Scope) {
  return envelope(seq, 'text', { channel, text }, scope)
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
  it('runs a tool then settles it success on result', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), toolResult(2, 'tc-1', true)])
    expect(tool(m, 'tc-1').status).toBe('success')
    expect(tool(m, 'tc-1').result?.success).toBe(true)
  })

  it('settles a tool error on a failed result', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), toolResult(2, 'tc-1', false)])
    expect(tool(m, 'tc-1').status).toBe('error')
  })

  it('honors an explicit terminal status over the success boolean', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), toolResult(2, 'tc-1', true, 'cancelled')])
    expect(tool(m, 'tc-1').status).toBe('cancelled')
  })

  it('accumulates streaming args across deltas', () => {
    const m = apply([
      toolCall(1, 'tc-1', 'workspace_file'),
      envelope(2, 'tool', {
        phase: 'args_delta',
        toolCallId: 'tc-1',
        toolName: 'workspace_file',
        argumentsDelta: '{"a":',
      }),
      envelope(3, 'tool', {
        phase: 'args_delta',
        toolCallId: 'tc-1',
        toolName: 'workspace_file',
        argumentsDelta: '1}',
      }),
    ])
    expect(tool(m, 'tc-1').streamingArgs).toBe('{"a":1}')
    expect(tool(m, 'tc-1').status).toBe('running')
  })

  it('clears streamingArgs once the result settles the tool', () => {
    const m = apply([
      toolCall(1, 'tc-1', 'workspace_file'),
      envelope(2, 'tool', {
        phase: 'args_delta',
        toolCallId: 'tc-1',
        toolName: 'workspace_file',
        argumentsDelta: '{"operation":"create"',
      }),
      toolResult(3, 'tc-1', true),
    ])
    expect(tool(m, 'tc-1').status).toBe('success')
    expect(tool(m, 'tc-1').streamingArgs).toBeUndefined()
  })

  it('buffers a result that arrives before its call, then applies it', () => {
    const m = apply([toolResult(1, 'tc-1', true), toolCall(2, 'tc-1', 'search')])
    expect(tool(m, 'tc-1').status).toBe('success')
  })

  it('preserves result.error when a result is buffered before its call', () => {
    const m = apply([
      envelope(1, 'tool', {
        phase: 'result',
        toolCallId: 'tc-1',
        toolName: 'search',
        success: false,
        error: 'boom',
      }),
      toolCall(2, 'tc-1', 'search'),
    ])
    expect(tool(m, 'tc-1').status).toBe('error')
    expect(tool(m, 'tc-1').result?.error).toBe('boom')
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

  it('ignores preview phases (decoupled from tool status)', () => {
    const m = apply([
      toolCall(1, 'tc-1', 'workspace_file'),
      envelope(2, 'tool', {
        previewPhase: 'file_preview_content',
        toolCallId: 'tc-1',
        toolName: 'workspace_file',
        content: 'x',
        contentMode: 'delta',
        fileName: 'f',
        previewVersion: 1,
      }),
    ])
    expect(tool(m, 'tc-1').status).toBe('running')
    expect(m.order).toEqual(['tc-1'])
  })
})

describe('reduceEvent — subagent lifecycle', () => {
  it('opens an agent run on span start and settles it on span end', () => {
    const m = apply([spanStart(1, 'S1', 'file', 'tc-file'), spanEnd(2, 'S1', 'file')])
    expect(agent(m, 'S1').status).toBe('success')
    expect(agent(m, 'S1').triggerToolCallId).toBe('tc-file')
    expect(agent(m, 'S1').parentSpanId).toBe(MAIN_SPAN)
  })

  it('settles an agent error when span end carries an error', () => {
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      spanEnd(2, 'S1', 'file', { error: 'boom' }),
    ])
    expect(agent(m, 'S1').status).toBe('error')
  })

  it('keeps an agent running on a pending-pause span end', () => {
    const m = apply([
      spanStart(1, 'S1', 'deploy', 'tc-deploy'),
      spanEnd(2, 'S1', 'deploy', { pending: true }),
    ])
    expect(agent(m, 'S1').status).toBe('running')
  })

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
      toolCall(3, 'wf-a', 'workspace_file', { lane: 'subagent', spanId: 'S1' }),
      toolCall(4, 'wf-b', 'workspace_file', { lane: 'subagent', spanId: 'S2' }),
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

describe('reduceEvent — text segmentation', () => {
  it('records wall-clock start/end for a thinking segment from wire ts', () => {
    // envelope() stamps ts = new Date(seq).toISOString(), so tsMs === seq here.
    const m = apply([
      textEvent(1, 'thinking', 'pondering'),
      textEvent(2, 'assistant', 'the answer'),
    ])
    const thinking = [...m.nodes.values()].find(
      (n) => n.kind === 'text' && n.channel === 'thinking'
    ) as TextNode
    expect(thinking.startedAtMs).toBe(1)
    // The answer starting closes the thinking segment, bounding its duration.
    expect(thinking.endedAtMs).toBe(2)
  })

  it('merges contiguous deltas and splits across a tool boundary', () => {
    const m = apply([
      textEvent(1, 'assistant', 'Hello '),
      textEvent(2, 'assistant', 'world'),
      toolCall(3, 'tc-1', 'search'),
      toolResult(4, 'tc-1', true),
      textEvent(5, 'assistant', 'after'),
    ])
    const texts = m.order.map((id) => m.nodes.get(id)).filter((n) => n?.kind === 'text')
    expect(texts.map((t) => (t as { text: string }).text)).toEqual(['Hello world', 'after'])
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
      toolCall(2, 'wf', 'workspace_file', { lane: 'subagent', spanId: 'S1' }),
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

describe('reduceEvent — edit_content row merge', () => {
  it('folds an edit_content write into its span workspace_file row', () => {
    const sub: Scope = { lane: 'subagent', spanId: 'S1' }
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf-1', 'workspace_file', sub),
      toolResult(3, 'wf-1', true, undefined, sub),
      toolCall(4, 'ec-1', 'edit_content', sub),
    ])
    // No separate edit_content node; the workspace_file row reopened for the edit.
    expect(m.nodes.has('ec-1')).toBe(false)
    expect(tool(m, 'wf-1').status).toBe('running')
    expect(m.toolAlias.get('ec-1')).toBe('wf-1')
  })

  it('settles the merged row on the edit_content result', () => {
    const sub: Scope = { lane: 'subagent', spanId: 'S1' }
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf-1', 'workspace_file', sub),
      toolCall(3, 'ec-1', 'edit_content', sub),
      toolResult(4, 'ec-1', true, undefined, sub),
    ])
    expect(tool(m, 'wf-1').status).toBe('success')
    expect(m.nodes.has('ec-1')).toBe(false)
  })

  it('folds an edit_content result that raced ahead of its call into the merged row', () => {
    const sub: Scope = { lane: 'subagent', spanId: 'S1' }
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf-1', 'workspace_file', sub),
      // Result for edit_content arrives BEFORE its call (buffered under ec-1)...
      toolResult(3, 'ec-1', true, undefined, sub),
      // ...then the call lands and aliases ec-1 -> wf-1, draining the buffer.
      toolCall(4, 'ec-1', 'edit_content', sub),
    ])
    expect(tool(m, 'wf-1').status).toBe('success')
    expect(tool(m, 'wf-1').result?.success).toBe(true)
    expect(m.bufferedResults.has('ec-1')).toBe(false)
  })

  it('finalizes a stale running section row when the next section opens', () => {
    const sub: Scope = { lane: 'subagent', spanId: 'S1' }
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      // Section 1: the workspace_file row is reopened by its edit_content, but the
      // edit's closing result is reordered/dropped — wf-1 is left running.
      toolCall(2, 'wf-1', 'workspace_file', sub),
      toolResult(3, 'wf-1', true, undefined, sub),
      toolCall(4, 'ec-1', 'edit_content', sub),
      // Section 2 opens before section 1's edit result lands.
      toolCall(5, 'wf-2', 'workspace_file', sub),
    ])
    // The previous section settles instead of spinning until the turn terminal...
    expect(tool(m, 'wf-1').status).toBe('success')
    // ...and the new section's row is the live write.
    expect(tool(m, 'wf-2').status).toBe('running')
  })
})

describe('reduceEvent — error tag + compaction coverage', () => {
  it('appends an inline mothership-error tag to the scoped lane text', () => {
    const m = apply([
      textEvent(1, 'assistant', 'Working'),
      envelope(2, 'error', { message: 'boom', code: 'E1', provider: 'openai' }),
    ])
    const text = [...m.nodes.values()].find((n) => n.kind === 'text') as { text: string }
    expect(text.text).toContain('<mothership-error>')
    expect(text.text).toContain('boom')
    expect(text.text).toContain('E1')
  })

  it('does not duplicate an identical error tag', () => {
    const m = apply([
      textEvent(1, 'assistant', 'Working'),
      envelope(2, 'error', { message: 'boom' }),
      envelope(3, 'error', { message: 'boom' }),
    ])
    const text = [...m.nodes.values()].find((n) => n.kind === 'text') as { text: string }
    const occurrences = text.text.split('<mothership-error>').length - 1
    expect(occurrences).toBe(1)
  })

  it('opens and closes a compaction node with titles', () => {
    const m = apply([
      envelope(1, 'run', { kind: 'compaction_start' }),
      envelope(2, 'run', { kind: 'compaction_done' }),
    ])
    const compaction = [...m.nodes.values()].find(
      (n) => n.kind === 'tool' && n.name === 'context_compaction'
    ) as ToolNode
    expect(compaction.status).toBe('success')
    expect(compaction.uiTitle).toBe('Summarizing context')
  })

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
  it('settles stragglers as success on a clean complete (never interrupted)', () => {
    const m = apply([
      toolCall(1, 'tc-1', 'search'),
      spanStart(2, 'S1', 'file', 'tc-file'),
      complete(3, 'complete'),
    ])
    expect(m.status).toBe('complete')
    expect(tool(m, 'tc-1').status).toBe('success')
    expect(agent(m, 'S1').status).toBe('success')
    for (const node of m.nodes.values()) {
      expect(node.kind === 'text' || node.status).not.toBe('interrupted')
    }
  })

  it('closes a straggler subagent lane (sets endSeq) so a model-driven terminal resolves the group', () => {
    // A file subagent opened but no span end arrived (mid-stream error/disconnect).
    const m = apply([
      spanStart(1, 'S1', 'file', 'tc-file'),
      toolCall(2, 'wf-1', 'workspace_file', { lane: 'subagent', spanId: 'S1' }),
    ])
    expect(agent(m, 'S1').endSeq).toBeUndefined()
    applyTurnTerminal(m, 'error')
    expect(agent(m, 'S1').status).toBe('error')
    // endSeq must be stamped so the serializer emits subagent_end and the lane's
    // delegating spinner resolves instead of spinning forever.
    expect(agent(m, 'S1').endSeq).toBeDefined()
  })

  it('settles open nodes cancelled on a stop', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), complete(2, 'cancelled')])
    expect(m.status).toBe('cancelled')
    expect(tool(m, 'tc-1').status).toBe('cancelled')
  })

  it('settles open nodes error on an errored turn', () => {
    const m = apply([toolCall(1, 'tc-1', 'search'), complete(2, 'error')])
    expect(m.status).toBe('error')
    expect(tool(m, 'tc-1').status).toBe('error')
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
