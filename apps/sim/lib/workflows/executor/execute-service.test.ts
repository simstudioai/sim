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
  it('returns null when no selectors were requested', async () => {
    expect(await pickRunBlockOutputs(undefined, blocks, [log(AGENT_ID, {})])).toBeNull()
    expect(await pickRunBlockOutputs([], blocks, [log(AGENT_ID, {})])).toBeNull()
  })

  it('resolves block names and ids, digging nested paths', async () => {
    const logs = [log(AGENT_ID, { content: 'hi', tokens: { total: 7 } })]

    expect(
      await pickRunBlockOutputs(['Agent 1.content', 'Agent 1.tokens.total', AGENT_ID], blocks, logs)
    ).toEqual({
      'Agent 1.content': 'hi',
      'Agent 1.tokens.total': 7,
      [AGENT_ID]: { content: 'hi', tokens: { total: 7 } },
    })
  })

  it('omits selectors for unknown blocks, unexecuted blocks, and absent paths', async () => {
    const logs = [log(AGENT_ID, { content: 'hi' })]

    // An unknown block is a caller error and throws (the CLI turns it into
    // `--select-output did not resolve to any block`); known-but-unexecuted blocks
    // and absent paths are simply omitted.
    await expect(pickRunBlockOutputs(['Missing.content'], blocks, logs)).rejects.toThrow(
      'does not resolve'
    )
    expect(await pickRunBlockOutputs(['Router.route', 'Agent 1.absent'], blocks, logs)).toEqual({})
  })

  it('reports the last log per block so loop iterations settle on final state', async () => {
    const logs = [log(AGENT_ID, { content: 'first' }), log(AGENT_ID, { content: 'last' })]

    expect(await pickRunBlockOutputs(['Agent 1.content'], blocks, logs)).toEqual({
      'Agent 1.content': 'last',
    })
  })
})
