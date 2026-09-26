import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { authOAuthUtilsMock } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/triggers/constants', () => ({ MAX_CONSECUTIVE_FAILURES: 5 }))

import { sql } from 'drizzle-orm'
import { updateWebhookProviderConfig } from '@/lib/webhooks/polling/utils'

afterAll(resetDbChainMock)

const logger = { error: vi.fn() } as never

/** Every value interpolated into a `sql` template, with `sql.param(value)` binds unwrapped. */
function allInterpolatedValues(): unknown[] {
  const params = new Map(
    vi
      .mocked(sql.param)
      .mock.results.map((result, index) => [
        result.value,
        vi.mocked(sql.param).mock.calls[index][0],
      ])
  )
  return vi
    .mocked(sql)
    .mock.calls.flatMap(([, ...values]) => values)
    .map((value) => (params.has(value) ? params.get(value) : value))
}

describe('updateWebhookProviderConfig (atomic jsonb merge)', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('merges defined keys (null preserved) and removes undefined keys', async () => {
    await updateWebhookProviderConfig(
      'wh-1',
      { historyId: 'h1', cleared: undefined, nulled: null },
      logger
    )

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(allInterpolatedValues()).toContain(JSON.stringify({ historyId: 'h1', nulled: null }))
    expect(allInterpolatedValues()).toContain('cleared')
  })
})
