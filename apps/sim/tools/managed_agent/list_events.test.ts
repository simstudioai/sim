/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeManagedAgentListEventsOperation } from '@/lib/internal/managed-agent/operations/list-events'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

/** One page of `count` events, no next page. */
const historyOf = (count: number) =>
  vi.fn(async () =>
    Response.json({
      data: Array.from({ length: count }, (_, i) => ({
        id: `e${i}`,
        type: 'agent.message',
        processed_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
        content: [{ type: 'text', text: `m${i}` }],
      })),
      next_page: null,
    })
  ) as unknown as typeof fetch

const run = (limit: unknown) =>
  executeManagedAgentListEventsOperation(
    { credential: 'c', accessToken: 'sk-ant-fake', sessionId: 'sesn_1', limit } as never,
    undefined
  )

describe('managed_agent_list_events — limit handling', () => {
  it.each([0.5, 0, -1, Number.NaN, 'abc', null, undefined])(
    'falls back to the 500 default for the invalid limit %p rather than reading unbounded',
    async (limit) => {
      global.fetch = historyOf(600)
      const res = (await run(limit)) as { output: { count: number; truncated: boolean } }
      expect(res.output.count).toBe(500)
      expect(res.output.truncated).toBe(true)
    }
  )

  it('honors a valid limit and keeps the newest events', async () => {
    global.fetch = historyOf(50)
    const res = (await run(10)) as {
      output: { count: number; truncated: boolean; assistantText: string }
    }
    expect(res.output.count).toBe(10)
    expect(res.output.truncated).toBe(true)
    // Newest ten are m40..m49, concatenated in chronological order.
    expect(res.output.assistantText).toBe(
      Array.from({ length: 10 }, (_, i) => `m${40 + i}`).join('')
    )
  })

  it('reports a complete history as not truncated even at exactly the limit', async () => {
    global.fetch = historyOf(10)
    const res = (await run(10)) as { output: { count: number; truncated: boolean } }
    expect(res.output.count).toBe(10)
    expect(res.output.truncated).toBe(false)
  })
})
