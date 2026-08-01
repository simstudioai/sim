/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { managedAgentUpdateSessionTool } from '@/tools/managed_agent/update_session'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

const capture = () => {
  const spy = vi.fn(async () => Response.json({ status: 'idle' })) as unknown as typeof fetch
  global.fetch = spy
  return spy as unknown as ReturnType<typeof vi.fn>
}

const run = (params: Record<string, unknown>) =>
  managedAgentUpdateSessionTool.directExecution!(
    { credential: 'c', accessToken: 'sk-ant-fake', sessionId: 'sesn_1', ...params } as never,
    undefined
  )

const bodyOf = (spy: ReturnType<typeof vi.fn>) =>
  JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string)

describe('managed_agent_update_session — metadata clearing', () => {
  it('does not touch metadata on a title-only update', async () => {
    const spy = capture()
    await run({ title: 'renamed' })
    expect(bodyOf(spy)).toEqual({ title: 'renamed' })
  })

  it.each([[[]], [{}], [undefined]])(
    'leaves stored metadata alone for the empty value %p rather than wiping it',
    async (sessionParameters) => {
      // An untouched metadata table is also empty, so emptiness cannot mean
      // "clear" — inferring it would wipe metadata on every title-only update.
      const spy = capture()
      await run({ title: 'renamed', sessionParameters })
      expect(bodyOf(spy).metadata).toBeUndefined()
    }
  )

  it('clears metadata only when explicitly asked', async () => {
    const spy = capture()
    await run({ clearMetadata: true })
    expect(bodyOf(spy)).toEqual({ metadata: {} })
  })

  it('lets an explicit clear win over a supplied map', async () => {
    const spy = capture()
    await run({ clearMetadata: true, sessionParameters: { a: 'b' } })
    expect(bodyOf(spy).metadata).toEqual({})
  })

  it('still refuses a no-op update', async () => {
    capture()
    const res = (await run({})) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Clear metadata/)
  })
})
