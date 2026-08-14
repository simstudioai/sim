/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { handleTextEvent } from '@/lib/copilot/request/handlers/text'
import type { StreamingContext } from '@/lib/copilot/request/types'

function laneTextEvent(text: string) {
  return {
    type: 'text',
    payload: { channel: 'assistant', text },
    scope: { lane: 'subagent', parentToolCallId: 'tc-1', agentId: 'file', spanId: 'S1' },
  } as never
}

function makeContext(): StreamingContext {
  return {
    contentBlocks: [{ type: 'subagent', content: 'file', parentToolCallId: 'tc-1', timestamp: 1 }],
    subAgentContent: {},
    subagentThinkingBlocks: new Map(),
    isInThinkingBlock: false,
  } as unknown as StreamingContext
}

describe('subagent intent extraction (server relay)', () => {
  it('strips a split tag and stamps the lane block intent', async () => {
    const ctx = makeContext()
    const handler = handleTextEvent('subagent')
    await handler(laneTextEvent('<int'), ctx, {} as never, {} as never)
    await handler(
      laneTextEvent('ent>Drafting outline</intent>\nStarting now.'),
      ctx,
      {} as never,
      {} as never
    )

    const start = ctx.contentBlocks.find((b) => b.type === 'subagent')
    expect(start?.subagentIntent).toBe('Drafting outline')
    const text = ctx.contentBlocks.find((b) => b.type === 'subagent_text')
    expect(text?.content).toBe('Starting now.')
    expect(ctx.subAgentContent['tc-1']).toBe('Starting now.')
  })

  it('takes the latest tag and keeps surrounding prose', async () => {
    const ctx = makeContext()
    const handler = handleTextEvent('subagent')
    await handler(
      laneTextEvent('a<intent>One</intent>b<intent>Two</intent>c'),
      ctx,
      {} as never,
      {} as never
    )
    const start = ctx.contentBlocks.find((b) => b.type === 'subagent')
    expect(start?.subagentIntent).toBe('Two')
    expect(ctx.subAgentContent['tc-1']).toBe('abc')
  })
})
