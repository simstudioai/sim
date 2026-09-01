/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { pickRunBlockOutputs } from '@/lib/workflows/executor/execute-service'
import type { BlockLog } from '@/executor/types'

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROUTER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const blocks = {
  [AGENT_ID]: { id: AGENT_ID, name: 'Agent 1' },
  [ROUTER_ID]: { id: ROUTER_ID, name: 'Router' },
}

function log(blockId: string, output: Record<string, unknown>): BlockLog {
  return {
    blockId,
    startedAt: 's',
    endedAt: 'e',
    durationMs: 1,
    success: true,
    output,
  }
}

describe('pickRunBlockOutputs', () => {
  it('returns null when no selectors were requested', () => {
    expect(pickRunBlockOutputs(undefined, blocks, [log(AGENT_ID, {})])).toBeNull()
    expect(pickRunBlockOutputs([], blocks, [log(AGENT_ID, {})])).toBeNull()
  })

  it('resolves block names and ids, digging nested paths', () => {
    const logs = [log(AGENT_ID, { content: 'hi', tokens: { total: 7 } })]

    expect(
      pickRunBlockOutputs(['Agent 1.content', 'Agent 1.tokens.total', AGENT_ID], blocks, logs)
    ).toEqual({
      'Agent 1.content': 'hi',
      'Agent 1.tokens.total': 7,
      [AGENT_ID]: { content: 'hi', tokens: { total: 7 } },
    })
  })

  it('omits selectors for unknown blocks, unexecuted blocks, and absent paths', () => {
    const logs = [log(AGENT_ID, { content: 'hi' })]

    expect(
      pickRunBlockOutputs(['Missing.content', 'Router.route', 'Agent 1.absent'], blocks, logs)
    ).toEqual({})
  })

  it('reports the last log per block so loop iterations settle on final state', () => {
    const logs = [log(AGENT_ID, { content: 'first' }), log(AGENT_ID, { content: 'last' })]

    expect(pickRunBlockOutputs(['Agent 1.content'], blocks, logs)).toEqual({
      'Agent 1.content': 'last',
    })
  })
})
