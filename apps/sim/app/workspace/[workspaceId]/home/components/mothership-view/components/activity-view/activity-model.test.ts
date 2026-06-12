/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { MothershipStreamV1EventEnvelope } from '@/lib/copilot/generated/mothership-stream-v1'
import {
  activityReducer,
  createInitialActivityModel,
  MOTHERSHIP_ACTOR_ID,
  reduceActivity,
} from './activity-model'

function isoAt(i: number): string {
  return new Date(1000 * (i + 1)).toISOString()
}

/** Common envelope scaffolding (seq/ts/v/stream) for a single stream. */
function common(i: number) {
  return { seq: i, ts: isoAt(i), v: 1 as const, stream: { streamId: 's1' } }
}

/**
 * A realistic "research these competitors and put them in a table" turn:
 * Mothership deploys the Research Agent and Table Agent in parallel, each runs
 * a tool, a table artifact is declared, both agents finish, the turn completes.
 */
function parallelResearchAndTable(): MothershipStreamV1EventEnvelope[] {
  return [
    { ...common(0), type: 'session', payload: { kind: 'start', data: {} } },
    { ...common(1), type: 'session', payload: { kind: 'title', title: 'Competitor research' } },
    {
      ...common(2),
      type: 'text',
      payload: { channel: 'thinking', text: 'Planning the approach…' },
    },
    {
      ...common(3),
      type: 'span',
      scope: { lane: 'subagent', agentId: 'a-research' },
      payload: { kind: 'subagent', event: 'start', agent: 'research' },
    },
    {
      ...common(4),
      type: 'span',
      scope: { lane: 'subagent', agentId: 'a-table' },
      payload: { kind: 'subagent', event: 'start', agent: 'table' },
    },
    {
      ...common(5),
      type: 'tool',
      scope: { lane: 'subagent', agentId: 'a-research' },
      payload: {
        phase: 'call',
        toolCallId: 't-search',
        toolName: 'search_online',
        executor: 'go',
        mode: 'sync',
      },
    },
    {
      ...common(6),
      type: 'tool',
      scope: { lane: 'subagent', agentId: 'a-table' },
      payload: {
        phase: 'call',
        toolCallId: 't-table',
        toolName: 'user_table',
        executor: 'sim',
        mode: 'sync',
      },
    },
    {
      ...common(7),
      type: 'resource',
      payload: { op: 'upsert', resource: { id: 'tbl-1', type: 'table', title: 'Competitors' } },
    },
    {
      ...common(8),
      type: 'tool',
      scope: { lane: 'subagent', agentId: 'a-research' },
      payload: {
        phase: 'result',
        toolCallId: 't-search',
        toolName: 'search_online',
        executor: 'go',
        mode: 'sync',
        success: true,
        status: 'success',
      },
    },
    {
      ...common(9),
      type: 'tool',
      scope: { lane: 'subagent', agentId: 'a-table' },
      payload: {
        phase: 'result',
        toolCallId: 't-table',
        toolName: 'user_table',
        executor: 'sim',
        mode: 'sync',
        success: true,
        status: 'success',
      },
    },
    {
      ...common(10),
      type: 'span',
      scope: { lane: 'subagent', agentId: 'a-research' },
      payload: { kind: 'subagent', event: 'end', agent: 'research' },
    },
    {
      ...common(11),
      type: 'span',
      scope: { lane: 'subagent', agentId: 'a-table' },
      payload: { kind: 'subagent', event: 'end', agent: 'table' },
    },
    {
      ...common(12),
      type: 'complete',
      payload: { status: 'complete', usage: { total_tokens: 1234 } },
    },
  ]
}

describe('activityReducer — parallel research + table scene', () => {
  it('shows two parallel agent lanes while both are active', () => {
    const events = parallelResearchAndTable().slice(0, 7) // through both tool calls
    const model = events.reduce(activityReducer, createInitialActivityModel())

    expect(model.scene).toBe('composite')
    expect(model.topology).toBe('parallel')
    expect(model.phase).toBe('working')

    expect(model.actors['a-research']?.label).toBe('Research Agent')
    expect(model.actors['a-research']?.state).toBe('active')
    expect(model.actors['a-table']?.label).toBe('Table Agent')
    expect(model.actors['a-table']?.state).toBe('active')

    const search = model.activities.find((a) => a.toolCallId === 't-search')
    expect(search?.ownerActorId).toBe('a-research')
    expect(search?.family).toBe('search')
    expect(search?.verb).toBe('Searching online')
    expect(search?.state).toBe('generating')
  })

  it('resolves to a completed turn with both agents done and the artifact tracked', () => {
    const model = reduceActivity(parallelResearchAndTable())

    expect(model.title).toBe('Competitor research')
    expect(model.phase).toBe('complete')

    expect(model.actors['a-research']?.state).toBe('done')
    expect(model.actors['a-table']?.state).toBe('done')

    const search = model.activities.find((a) => a.toolCallId === 't-search')
    const table = model.activities.find((a) => a.toolCallId === 't-table')
    expect(search?.state).toBe('success')
    expect(table?.state).toBe('success')
    expect(table?.ownerActorId).toBe('a-table')

    expect(model.artifacts['tbl-1']).toMatchObject({ type: 'table', title: 'Competitors' })
    // The table artifact associates to the Table Agent lane so it can preview in-lane.
    expect(model.artifacts['tbl-1']?.ownerActorId).toBe('a-table')
  })
})

describe('activityReducer — lifecycle states', () => {
  it('enters paused with confirmation attention on a checkpoint, then resumes', () => {
    const paused = [
      { ...common(0), type: 'session', payload: { kind: 'start', data: {} } },
      {
        ...common(1),
        type: 'run',
        payload: {
          kind: 'checkpoint_pause',
          checkpointId: 'c1',
          executionId: 'e1',
          runId: 'r1',
          pendingToolCallIds: ['t-x'],
        },
      },
    ] satisfies MothershipStreamV1EventEnvelope[]
    let model = reduceActivity(paused)
    expect(model.phase).toBe('paused')
    expect(model.attention).toMatchObject({ kind: 'confirmation', pendingToolCallIds: ['t-x'] })

    model = activityReducer(model, {
      ...common(2),
      type: 'run',
      payload: { kind: 'resumed' },
    })
    expect(model.phase).toBe('working')
    expect(model.attention).toBeUndefined()
  })

  it('flags hidden tools so the renderer can skip them', () => {
    const model = reduceActivity([
      { ...common(0), type: 'session', payload: { kind: 'start', data: {} } },
      {
        ...common(1),
        type: 'tool',
        payload: {
          phase: 'call',
          toolCallId: 't-hidden',
          toolName: 'read',
          executor: 'go',
          mode: 'sync',
          ui: { hidden: true },
        },
      },
    ])
    const hidden = model.activities.find((a) => a.toolCallId === 't-hidden')
    expect(hidden?.hidden).toBe(true)
    expect(model.actors[MOTHERSHIP_ACTOR_ID]).toBeDefined()
  })

  it('marks a cancelled turn without downgrading from a later stray event', () => {
    let model = reduceActivity([
      { ...common(0), type: 'session', payload: { kind: 'start', data: {} } },
      { ...common(1), type: 'complete', payload: { status: 'cancelled' } },
    ])
    expect(model.phase).toBe('cancelled')
    // A late text event must not pull us back to 'working'.
    model = activityReducer(model, {
      ...common(2),
      type: 'text',
      payload: { channel: 'assistant', text: 'trailing' },
    })
    expect(model.phase).toBe('cancelled')
  })
})
