import { describe, expect, it } from 'vitest'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
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

describe('activity metadata replay', () => {
  it('carries hidden discovery labels onto later visible calls without crossing agent lanes', () => {
    const activity = {
      id: 'inputs',
      completedTitle: 'Checked invoice requirements',
    }
    const childActivity = {
      id: 'inputs',
      completedTitle: 'Checked customer requirements',
    }
    const model = build([
      env(1, 'tool', {
        phase: 'call',
        toolCallId: 'skill',
        toolName: 'load_skill',
        arguments: { name: 'build-workflow', activity },
        ui: { hidden: true },
      }),
      env(
        2,
        'tool',
        {
          phase: 'call',
          toolCallId: 'child-skill',
          toolName: 'load_skill',
          arguments: { name: 'build-workflow', activity: childActivity },
          ui: { hidden: true },
        },
        { lane: 'subagent', spanId: 'child' }
      ),
      env(3, 'text', { channel: 'assistant', text: 'Now inspecting the inputs.' }),
      env(4, 'tool', {
        phase: 'call',
        toolCallId: 'read',
        toolName: 'sim_cli',
        arguments: { args: ['blocks', 'get', 'start_trigger'], activity: { id: 'inputs' } },
      }),
    ])
    const blocks = modelToContentBlocks(model)
    expect(blocks.filter((block) => block.toolCall)).toHaveLength(1)
    expect(blocks.find((block) => block.toolCall)?.toolCall?.params?.activity).toEqual(activity)
    const replay = modelToContentBlocks(contentBlocksToModel(blocks))
    expect(replay.find((block) => block.toolCall)?.toolCall?.params?.activity).toEqual(activity)
  })
})

describe('modelToContentBlocks', () => {
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
          { phase: 'call', toolCallId: 'wf-1', toolName: 'prepare_file_edit' },
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
    const innerIdx = blocks.findIndex((b) => b.toolCall?.name === 'prepare_file_edit')
    const endIdx = types.indexOf('subagent_end')
    const afterIdx = blocks.findIndex((b) => b.type === 'text' && b.content === 'after')
    // subagent_end sits after the inner work and before the trailing main text — no sibling jumps.
    expect(endIdx).toBeGreaterThan(innerIdx)
    expect(afterIdx).toBeGreaterThan(endIdx)
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
        { phase: 'call', toolCallId: 'wf-1', toolName: 'prepare_file_edit' },
        { lane: 'subagent', spanId: 'S1' }
      ),
    ])
    applyTurnTerminal(m, 'error')
    const blocks = modelToContentBlocks(m)
    expect(blocks.some((b) => b.type === 'subagent_end' && b.spanId === 'S1')).toBe(true)
  })
})

describe('background task pill', () => {
  it('folds task_armed into a task block, resolves it on task_delivered, and survives the round-trip', () => {
    const armed = build([
      env(1, 'run', {
        kind: 'task_armed',
        taskId: 'task-1',
        taskKind: 'workflow_run',
        target: { executionId: 'exec-9' },
        note: 'check the errors',
      }),
    ])
    const blocks = modelToContentBlocks(armed)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'task',
      task: { taskId: 'task-1', kind: 'workflow_run', status: 'pending', note: 'check the errors' },
    })

    reduceEvent(
      armed,
      env(2, 'run', {
        kind: 'task_delivered',
        taskId: 'task-1',
        status: 'failed',
        summary: 'Slack block failed',
      })
    )
    const delivered = modelToContentBlocks(armed)
    expect(delivered[0]).toMatchObject({
      type: 'task',
      task: { status: 'failed', summary: 'Slack block failed' },
    })

    const rebuilt = contentBlocksToModel(delivered)
    const node = rebuilt.nodes.get('task:task-1')
    expect(node?.kind).toBe('task')
    expect(node?.kind === 'task' && node.task).toMatchObject({
      status: 'failed',
      summary: 'Slack block failed',
    })
  })
})

describe('contentBlocksToModel round-trip', () => {
  function tool(model: TurnModel, id: string): ToolNode {
    return model.nodes.get(id) as ToolNode
  }
  function agent(model: TurnModel, spanId: string): AgentNode {
    return model.nodes.get(spanId) as AgentNode
  }

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
        { phase: 'call', toolCallId: 'wf-1', toolName: 'prepare_file_edit' },
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
