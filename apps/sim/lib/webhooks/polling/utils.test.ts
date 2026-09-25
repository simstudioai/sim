import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { sqlCalls } = vi.hoisted(() => ({
  sqlCalls: [] as Array<{ strings: readonly string[]; values: unknown[] }>,
}))

vi.mock('drizzle-orm', () => {
  const sql = (strings: readonly string[], ...values: unknown[]) => {
    const node = { strings, values }
    sqlCalls.push(node)
    return node
  }
  // Identity, so an interpolated value still shows up verbatim in `values`.
  sql.param = (value: unknown) => value
  sql.join = (fragments: unknown[], separator: unknown) => ({ fragments, separator })
  return {
    sql,
    and: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    isNull: vi.fn(),
    ne: vi.fn(),
    or: vi.fn(),
  }
})
vi.mock('@/lib/oauth/credential-service', () => ({
  getOAuthToken: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
  resolveOAuthAccountId: vi.fn(),
}))
vi.mock('@/triggers/constants', () => ({ MAX_CONSECUTIVE_FAILURES: 5 }))

import { updateWebhookProviderConfig } from '@/lib/webhooks/polling/utils'

afterAll(resetDbChainMock)

const logger = { error: vi.fn() } as never

function allInterpolatedValues(): unknown[] {
  return sqlCalls.flatMap((c) => c.values)
}

describe('updateWebhookProviderConfig (atomic jsonb merge)', () => {
  beforeEach(() => {
    resetDbChainMock()
    sqlCalls.length = 0
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
