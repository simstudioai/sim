/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  type AgentNode,
  applyTurnTerminal,
  createTurnModel,
  reduceEvent,
  type ToolNode,
  type TurnModel,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import {
  contentBlocksToModel,
  modelToContentBlocks,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model-serialize'

interface Scope {
  lane: 'subagent'
  spanId?: string
  parentSpanId?: string
  parentToolCallId?: string
  agentId?: string
}

function env(seq: number, type: string, payload: Record<string, unknown>, scope?: Scope) {
  return {
    v: 1,
    seq,
    // Real ts so tsMs === seq, exercising the wall-clock timing path.
    ts: new Date(seq).toISOString(),
    stream: { streamId: 's1', cursor: String(seq) },
    type,
    payload,
    ...(scope ? { scope } : {}),
  } as unknown as PersistedStreamEventEnvelope
}

function build(events: PersistedStreamEventEnvelope[]): TurnModel {
  const m = createTurnModel()
  for (const e of events) reduceEvent(m, e)
  return m
}

// A main-agent file delegation: trigger tool (main lane), subagent span, inner
// workspace_file, span end, delegation result.
function fileDelegationEvents(): PersistedStreamEventEnvelope[] {
  const sub: Scope = {
    lane: 'subagent',
    spanId: 'S1',
    parentSpanId: 'main',
    parentToolCallId: 'tc-file',
    agentId: 'file',
  }
  return [
    env(1, 'text', { channel: 'assistant', text: 'Writing the file.' }),
    env(2, 'tool', { phase: 'call', toolCallId: 'tc-file', toolName: 'file' }),
    env(
      3,
      'span',
      { kind: 'subagent', event: 'start', agent: 'file', data: { tool_call_id: 'tc-file' } },
      sub
    ),
    env(
      4,
      'tool',
      { phase: 'call', toolCallId: 'wf-1', toolName: 'workspace_file' },
      { lane: 'subagent', spanId: 'S1' }
    ),
    env(
      5,
      'tool',
      { phase: 'result', toolCallId: 'wf-1', toolName: 'workspace_file', success: true },
      { lane: 'subagent', spanId: 'S1' }
    ),
    env(
      6,
      'span',
      { kind: 'subagent', event: 'end', agent: 'file', data: {} },
      { lane: 'subagent', spanId: 'S1' }
    ),
    env(7, 'tool', { phase: 'result', toolCallId: 'tc-file', toolName: 'file', success: true }),
  ]
}

function blocksByType(blocks: ReturnType<typeof modelToContentBlocks>, type: string) {
  return blocks.filter((b) => b.type === type)
}

describe('modelToContentBlocks', () => {
  it('emits main-lane blocks without spanId and subagent-lane blocks with spanId', () => {
    const blocks = modelToContentBlocks(build(fileDelegationEvents()))

    const mainText = blocks.find((b) => b.type === 'text')
    expect(mainText?.spanId).toBeUndefined()

    const trigger = blocksByType(blocks, 'tool_call').find((b) => b.toolCall?.name === 'file')
    expect(trigger?.spanId).toBeUndefined()
    expect(trigger?.toolCall?.status).toBe('success')

    const innerTool = blocksByType(blocks, 'tool_call').find(
      (b) => b.toolCall?.name === 'workspace_file'
    )
    expect(innerTool?.spanId).toBe('S1')
    expect(innerTool?.toolCall?.calledBy).toBe('file')
    expect(innerTool?.toolCall?.status).toBe('success')

    const subagent = blocks.find((b) => b.type === 'subagent')
    expect(subagent?.spanId).toBe('S1')
    expect(subagent?.parentSpanId).toBe('main')
    expect(subagent?.parentToolCallId).toBe('tc-file')
  })

  it('orders blocks by wire seq and appends new content without reordering existing blocks', () => {
    const m = createTurnModel()
    reduceEvent(m, env(1, 'text', { channel: 'assistant', text: 'one' }))
    reduceEvent(m, env(2, 'tool', { phase: 'call', toolCallId: 't1', toolName: 'search' }))
    const snap1 = modelToContentBlocks(m)
    expect(snap1.map((b) => b.type)).toEqual(['text', 'tool_call'])

    // Later events arrive; the tool settles and new text starts.
    reduceEvent(
      m,
      env(3, 'tool', { phase: 'result', toolCallId: 't1', toolName: 'search', success: true })
    )
    reduceEvent(m, env(4, 'text', { channel: 'assistant', text: 'two' }))
    const snap2 = modelToContentBlocks(m)

    // Existing blocks keep their position (snap1 is a prefix of snap2); new text appends.
    expect(snap2.map((b) => b.type)).toEqual(['text', 'tool_call', 'text'])
    expect(snap2[1].toolCall?.id).toBe('t1')
    expect(snap2[0].content).toBe('one')
  })

  it('attributes subagent content that streams before its subagent_start (parallel-burst inversion)', () => {
    const sub: Scope = {
      lane: 'subagent',
      spanId: 'R1',
      parentSpanId: 'main',
      parentToolCallId: 'tc-r1',
      agentId: 'research',
    }
    const m = createTurnModel()
    reduceEvent(m, env(1, 'text', { channel: 'assistant', text: 'Spawning research.' }))
    // Under an 8-way burst the subagent's thinking + text can be reduced before
    // its subagent_start lands. The content already carries the lane identity.
    reduceEvent(m, env(2, 'text', { channel: 'thinking', text: 'Considering odds.' }, sub))
    reduceEvent(m, env(3, 'text', { channel: 'assistant', text: 'Team analysis.' }, sub))

    // Snapshot mid-burst (before the start): the research content must already be
    // its own lane, never leaked into the main ("Sim") lane with its thinking dropped.
    const mid = modelToContentBlocks(m)
    const midSub = mid.find((b) => b.type === 'subagent')
    expect(midSub?.content).toBe('research')
    expect(midSub?.spanId).toBe('R1')
    expect(mid.find((b) => b.type === 'subagent_thinking')?.spanId).toBe('R1')
    expect(mid.filter((b) => b.type === 'text' && b.spanId === 'R1')).toHaveLength(1)
    // The main lane holds only the pre-spawn text — nothing leaked in.
    const mainText = mid.filter((b) => b.type === 'text' && !b.spanId)
    expect(mainText).toHaveLength(1)
    expect(mainText[0].content).toBe('Spawning research.')

    // The real subagent_start lands afterward and no-ops: still one research lane.
    reduceEvent(
      m,
      env(
        4,
        'span',
        { kind: 'subagent', event: 'start', agent: 'research', data: { tool_call_id: 'tc-r1' } },
        sub
      )
    )
    const after = modelToContentBlocks(m)
    expect(after.filter((b) => b.type === 'subagent')).toHaveLength(1)
    expect(after.find((b) => b.type === 'subagent')?.content).toBe('research')
  })

  it('places subagent_end at its end seq (after the lane work), never reordering siblings', () => {
    const sub: Scope = {
      lane: 'subagent',
      spanId: 'S1',
      parentToolCallId: 'tc-file',
      agentId: 'file',
    }
    const blocks = modelToContentBlocks(
      build([
        env(1, 'text', { channel: 'assistant', text: 'before' }),
        env(2, 'tool', { phase: 'call', toolCallId: 'tc-file', toolName: 'file' }),
        env(
          3,
          'span',
          { kind: 'subagent', event: 'start', agent: 'file', data: { tool_call_id: 'tc-file' } },
          sub
        ),
        env(
          4,
          'tool',
          { phase: 'call', toolCallId: 'wf-1', toolName: 'workspace_file' },
          { lane: 'subagent', spanId: 'S1' }
        ),
        env(
          5,
          'span',
          { kind: 'subagent', event: 'end', agent: 'file', data: {} },
          { lane: 'subagent', spanId: 'S1' }
        ),
        env(6, 'text', { channel: 'assistant', text: 'after' }),
      ])
    )
    const types = blocks.map((b) => b.type)
    const innerIdx = blocks.findIndex((b) => b.toolCall?.name === 'workspace_file')
    const endIdx = types.indexOf('subagent_end')
    const afterIdx = blocks.findIndex((b) => b.type === 'text' && b.content === 'after')
    // subagent_end sits after the inner work and before the trailing main text — no sibling jumps.
    expect(endIdx).toBeGreaterThan(innerIdx)
    expect(afterIdx).toBeGreaterThan(endIdx)
  })

  it('preserves thinking timing across a model -> blocks -> model reconnect round-trip', () => {
    const m1 = build([
      env(1, 'text', { channel: 'thinking', text: 'pondering' }),
      env(2, 'text', { channel: 'assistant', text: 'the answer' }),
    ])
    const blocks1 = modelToContentBlocks(m1)
    const blocks2 = modelToContentBlocks(contentBlocksToModel(blocks1))
    const t1 = blocks1.find((b) => b.type === 'thinking')
    const t2 = blocks2.find((b) => b.type === 'thinking')
    expect(t1?.timestamp).toBe(1)
    expect(t1?.endedAt).toBe(2)
    // Reconnect rebuild must not reset timing to seq/undefined.
    expect(t2?.timestamp).toBe(t1?.timestamp)
    expect(t2?.endedAt).toBe(t1?.endedAt)
  })

  it('emits subagent_end for a straggler lane closed by a model terminal (no span end)', () => {
    const sub: Scope = {
      lane: 'subagent',
      spanId: 'S1',
      parentToolCallId: 'tc-file',
      agentId: 'file',
    }
    const m = build([
      env(1, 'tool', { phase: 'call', toolCallId: 'tc-file', toolName: 'file' }),
      env(
        2,
        'span',
        { kind: 'subagent', event: 'start', agent: 'file', data: { tool_call_id: 'tc-file' } },
        sub
      ),
      env(
        3,
        'tool',
        { phase: 'call', toolCallId: 'wf-1', toolName: 'workspace_file' },
        { lane: 'subagent', spanId: 'S1' }
      ),
    ])
    applyTurnTerminal(m, 'error')
    const blocks = modelToContentBlocks(m)
    expect(blocks.some((b) => b.type === 'subagent_end' && b.spanId === 'S1')).toBe(true)
  })

  it('skips per-call hidden tool nodes but keeps them in the model for side effects', () => {
    const m = build([
      env(1, 'tool', {
        phase: 'call',
        toolCallId: 'h-1',
        toolName: 'secret_tool',
        ui: { hidden: true },
      }),
      env(2, 'tool', {
        phase: 'result',
        toolCallId: 'h-1',
        toolName: 'secret_tool',
        success: true,
      }),
    ])
    expect(m.nodes.has('h-1')).toBe(true)
    expect(blocksByType(modelToContentBlocks(m), 'tool_call')).toHaveLength(0)
  })

  it('resolves a tool display title from its arguments', () => {
    const blocks = modelToContentBlocks(
      build([
        env(1, 'tool', {
          phase: 'call',
          toolCallId: 'wf',
          toolName: 'workspace_file',
          arguments: { operation: 'create', title: 'My Doc' },
        }),
      ])
    )
    const tool = blocksByType(blocks, 'tool_call').find((b) => b.toolCall?.id === 'wf')
    expect(tool?.toolCall?.displayTitle).toBeTruthy()
  })

  it('emits a paired subagent_end at the run end seq, ordered after the inner work', () => {
    const blocks = modelToContentBlocks(build(fileDelegationEvents()))
    const startIdx = blocks.findIndex((b) => b.type === 'subagent')
    const innerIdx = blocks.findIndex(
      (b) => b.type === 'tool_call' && b.toolCall?.name === 'workspace_file'
    )
    const endIdx = blocks.findIndex((b) => b.type === 'subagent_end')
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(endIdx).toBeGreaterThan(innerIdx)
    expect(innerIdx).toBeGreaterThan(startIdx)
  })

  it('omits subagent_end while the run is still open', () => {
    const sub: Scope = {
      lane: 'subagent',
      spanId: 'S1',
      parentSpanId: 'main',
      parentToolCallId: 'tc-file',
      agentId: 'file',
    }
    const blocks = modelToContentBlocks(
      build([
        env(1, 'tool', { phase: 'call', toolCallId: 'tc-file', toolName: 'file' }),
        env(2, 'span', { kind: 'subagent', event: 'start', agent: 'file', data: {} }, sub),
      ])
    )
    expect(blocksByType(blocks, 'subagent_end')).toHaveLength(0)
    expect(blocksByType(blocks, 'subagent')).toHaveLength(1)
  })

  it('persists a completed compaction inside its subagent span', () => {
    const sub: Scope = {
      lane: 'subagent',
      spanId: 'S1',
      parentSpanId: 'main',
      parentToolCallId: 'tc-workflow',
      agentId: 'workflow',
    }
    const blocks = modelToContentBlocks(
      build([
        env(
          1,
          'span',
          {
            kind: 'subagent',
            event: 'start',
            agent: 'workflow',
            data: { tool_call_id: 'tc-workflow' },
          },
          sub
        ),
        env(2, 'run', { kind: 'compaction_start' }, sub),
        env(3, 'run', { kind: 'compaction_done' }, sub),
      ])
    )

    const compaction = blocks.find(
      (block) => block.type === 'tool_call' && block.toolCall?.name === 'context_compaction'
    )
    expect(compaction).toEqual(
      expect.objectContaining({
        spanId: 'S1',
        parentSpanId: 'main',
        toolCall: expect.objectContaining({
          calledBy: 'workflow',
          status: 'success',
        }),
      })
    )
  })
})

describe('contentBlocksToModel round-trip', () => {
  function tool(model: TurnModel, id: string): ToolNode {
    return model.nodes.get(id) as ToolNode
  }
  function agent(model: TurnModel, spanId: string): AgentNode {
    return model.nodes.get(spanId) as AgentNode
  }

  it('rebuilds tool and agent statuses and nesting from serialized blocks', () => {
    const original = build(fileDelegationEvents())
    const rebuilt = contentBlocksToModel(modelToContentBlocks(original))

    expect(tool(rebuilt, 'tc-file').status).toBe('success')
    expect(tool(rebuilt, 'wf-1').status).toBe('success')
    expect(tool(rebuilt, 'wf-1').spanId).toBe('S1')
    expect(agent(rebuilt, 'S1').status).toBe('success')
    expect(agent(rebuilt, 'S1').parentSpanId).toBe('main')
    expect(agent(rebuilt, 'S1').triggerToolCallId).toBe('tc-file')
  })

  it('preserves a running tool and an open subagent across the round-trip', () => {
    const sub: Scope = {
      lane: 'subagent',
      spanId: 'S1',
      parentSpanId: 'main',
      parentToolCallId: 'tc-file',
      agentId: 'file',
    }
    const original = build([
      env(1, 'tool', { phase: 'call', toolCallId: 'tc-file', toolName: 'file' }),
      env(2, 'span', { kind: 'subagent', event: 'start', agent: 'file', data: {} }, sub),
      env(
        3,
        'tool',
        { phase: 'call', toolCallId: 'wf-1', toolName: 'workspace_file' },
        { lane: 'subagent', spanId: 'S1' }
      ),
    ])
    const rebuilt = contentBlocksToModel(modelToContentBlocks(original))
    expect(tool(rebuilt, 'wf-1').status).toBe('running')
    expect(agent(rebuilt, 'S1').status).toBe('running')
  })

  it('round-trips parallel same-name subagents on distinct spans', () => {
    const subA: Scope = {
      lane: 'subagent',
      spanId: 'SA',
      parentSpanId: 'main',
      parentToolCallId: 'tc-a',
      agentId: 'file',
    }
    const subB: Scope = {
      lane: 'subagent',
      spanId: 'SB',
      parentSpanId: 'main',
      parentToolCallId: 'tc-b',
      agentId: 'file',
    }
    const original = build([
      env(1, 'span', { kind: 'subagent', event: 'start', agent: 'file', data: {} }, subA),
      env(2, 'span', { kind: 'subagent', event: 'start', agent: 'file', data: {} }, subB),
      env(
        3,
        'span',
        { kind: 'subagent', event: 'end', agent: 'file', data: {} },
        { lane: 'subagent', spanId: 'SA' }
      ),
      env(
        4,
        'span',
        { kind: 'subagent', event: 'end', agent: 'file', data: {} },
        { lane: 'subagent', spanId: 'SB' }
      ),
    ])
    const rebuilt = contentBlocksToModel(modelToContentBlocks(original))
    expect(agent(rebuilt, 'SA').triggerToolCallId).toBe('tc-a')
    expect(agent(rebuilt, 'SB').triggerToolCallId).toBe('tc-b')
    expect(agent(rebuilt, 'SA').status).toBe('success')
    expect(agent(rebuilt, 'SB').status).toBe('success')
  })
})
