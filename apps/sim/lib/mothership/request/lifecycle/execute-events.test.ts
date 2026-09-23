import { describe, expect, it } from 'vitest'
import { ExecuteEventProjection } from '@/lib/mothership/request/lifecycle/execute-events'
import type { StreamEvent } from '@/lib/mothership/request/types'
import type { AgentStreamEvent } from '@/providers/stream-events'

function call(
  id: string,
  options: Partial<
    Extract<Extract<StreamEvent, { type: 'tool' }>['payload'], { phase: 'call' }>
  > = {}
): StreamEvent {
  return {
    type: 'tool',
    payload: {
      phase: 'call',
      toolCallId: id,
      toolName: 'lookup',
      executor: 'go',
      mode: 'sync',
      ...options,
    },
  }
}
function result(id: string, success = true): StreamEvent {
  return {
    type: 'tool',
    payload: {
      phase: 'result',
      toolCallId: id,
      toolName: 'lookup',
      executor: 'go',
      mode: 'sync',
      success,
      output: { secret: 'private-result' },
    },
  }
}
function text(value: string, textOffset?: number): StreamEvent {
  return {
    type: 'text',
    payload: {
      channel: 'assistant',
      text: value,
      ...(textOffset !== undefined ? { textOffset } : {}),
    },
  }
}
function projection() {
  const events: AgentStreamEvent[] = []
  return { events, project: new ExecuteEventProjection((event) => events.push(event)) }
}

describe('Mothership execute event projection', () => {
  it('pairs parallel and sequential tools, deduplicates resume and emits no tool payloads', () => {
    const { events, project } = projection()
    project.accept({ ...call('a', { arguments: { token: 'private-args' } }), seq: 1 })
    project.accept({ ...call('a'), seq: 1 })
    project.accept(call('a', { replay: true }))
    project.accept(call('b'))
    project.accept(result('b', false))
    project.accept(result('a'))
    project.accept(result('a'))
    project.accept(call('c'))
    project.accept(result('c'))
    project.accept(text('Complete ending.'))
    project.finish('success')
    project.finish('success')
    expect(events.filter((event) => event.type.startsWith('tool_call'))).toEqual([
      { type: 'tool_call_start', id: 'a', name: 'lookup' },
      { type: 'tool_call_start', id: 'b', name: 'lookup' },
      { type: 'tool_call_end', id: 'b', name: 'lookup', status: 'error' },
      { type: 'tool_call_end', id: 'a', name: 'lookup', status: 'success' },
      { type: 'tool_call_start', id: 'c', name: 'lookup' },
      { type: 'tool_call_end', id: 'c', name: 'lookup', status: 'success' },
    ])
    expect(events.slice(-2)).toEqual([
      { type: 'text_delta', text: 'Complete ending.', turn: 'pending' },
      { type: 'turn_end', turn: 'final' },
    ])
    expect(JSON.stringify(events)).not.toContain('private-')
  })

  it('excludes hidden, internal and subagent tools and thinking, even across call updates', () => {
    const { events, project } = projection()
    project.accept(call('hidden', { ui: { hidden: true } }))
    project.accept(call('hidden'))
    project.accept(result('hidden'))
    project.accept(call('internal', { ui: { internal: true } }))
    project.accept(result('internal'))
    const scope = { lane: 'subagent' as const, parentToolCallId: 'child' }
    for (const event of [
      call('child-tool'),
      result('child-tool'),
      text('private child'),
      {
        type: 'text',
        payload: { channel: 'thinking', text: 'private thought' },
      } satisfies StreamEvent,
    ]) {
      project.accept({ ...event, scope })
    }
    expect(events).toEqual([
      { type: 'turn_end', turn: 'intermediate' },
      { type: 'turn_end', turn: 'intermediate' },
    ])
  })

  it('keeps repeated deltas while deduplicating only explicitly positioned text', () => {
    const { events, project } = projection()
    project.accept(text('ha'))
    project.accept(text('ha'))
    project.accept(text('haha!', 0))
    project.accept(text('haha!', 0))
    expect(events).toEqual(
      ['ha', 'ha', '!'].map((value) => ({ type: 'text_delta', text: value, turn: 'pending' }))
    )
    expect(() => project.accept(text('changed', 0))).toThrow('differs')
  })

  it.each(['error', 'cancelled'] as const)(
    'settles outstanding tools on %s without claiming a complete answer',
    (status) => {
      const { events, project } = projection()
      project.accept(call('pending'))
      project.finish(status)
      project.accept(result('pending'))
      expect(events.at(-1)).toEqual({
        type: 'tool_call_end',
        id: 'pending',
        name: 'lookup',
        status,
      })
      expect(events).not.toContainEqual({ type: 'turn_end', turn: 'final' })
    }
  )
})
