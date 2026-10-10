import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { authOAuthUtilsMock } from '@sim/testing/mocks/auth-oauth-utils.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)
vi.mock('@/triggers/constants', () => ({ MAX_CONSECUTIVE_FAILURES: 5 }))

import { sql } from 'drizzle-orm'
import {
  createPayerUsageGate,
  getPollBackoffUntil,
  POLL_RETRY_AFTER_CONFIG_KEY,
  readPollRetryAfterMs,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'

afterAll(resetDbChainMock)

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never

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

describe('getPollBackoffUntil', () => {
  const now = Date.parse('2026-10-09T12:00:00.000Z')
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000)

  it.each([
    { failedCount: 0, lastFailedAt: null, polls: true },
    { failedCount: 1, lastFailedAt: minutesAgo(1), polls: true },
    { failedCount: 2, lastFailedAt: minutesAgo(1), polls: false },
    { failedCount: 2, lastFailedAt: minutesAgo(2), polls: true },
    { failedCount: 5, lastFailedAt: minutesAgo(10), polls: false },
    { failedCount: 5, lastFailedAt: minutesAgo(16), polls: true },
    { failedCount: 40, lastFailedAt: minutesAgo(59), polls: false },
    { failedCount: 40, lastFailedAt: minutesAgo(60), polls: true },
  ])(
    'after $failedCount consecutive failures, polls=$polls',
    ({ failedCount, lastFailedAt, polls }) => {
      const until = getPollBackoffUntil({ failedCount, lastFailedAt, providerConfig: {} }, now)
      expect(until === null).toBe(polls)
    }
  )

  it('waits out a persisted Retry-After that is longer than the failure backoff', () => {
    const retryAfter = new Date(now + 10 * 60_000).toISOString()
    expect(
      getPollBackoffUntil(
        {
          failedCount: 1,
          lastFailedAt: minutesAgo(5),
          providerConfig: { [POLL_RETRY_AFTER_CONFIG_KEY]: retryAfter },
        },
        now
      )
    ).toBe(Date.parse(retryAfter))
  })

  it('ignores an expired or malformed Retry-After', () => {
    for (const value of [new Date(now - 1000).toISOString(), 'not-a-date', 42]) {
      expect(
        getPollBackoffUntil(
          {
            failedCount: 0,
            lastFailedAt: null,
            providerConfig: { [POLL_RETRY_AFTER_CONFIG_KEY]: value },
          },
          now
        )
      ).toBeNull()
    }
  })
})

describe('readPollRetryAfterMs', () => {
  it.each([
    { header: '120', body: '', expected: 120_000 },
    { header: null, body: '{"description":"Too Many Requests: FLOOD_WAIT_12"}', expected: 12_000 },
    { header: null, body: 'FLOOD_WAIT_999999', expected: 24 * 60 * 60_000 },
    { header: '9999999', body: '', expected: 24 * 60 * 60_000 },
    { header: null, body: 'rate limited', expected: null },
  ])('reads $header / $body', ({ header, body, expected }) => {
    expect(readPollRetryAfterMs(header, body)).toBe(expected)
  })
})

describe('createPayerUsageGate', () => {
  beforeEach(() => {
    billingAttributionMockFns.mockResolveSystemBillingAttribution.mockResolvedValue({
      workspaceId: 'workspace-1',
    })
  })

  it('reports a payer the usage gate refuses', async () => {
    billingUsageGateCacheMockFns.mockCheckIngestionUsageLimits.mockResolvedValue({
      isExceeded: true,
    })
    expect(await createPayerUsageGate(logger)('workspace-1')).toBe(true)
  })

  it('lets the poll proceed when the payer cannot be resolved', async () => {
    billingAttributionMockFns.mockResolveSystemBillingAttribution.mockRejectedValue(
      new Error('payer lookup failed')
    )
    expect(await createPayerUsageGate(logger)('workspace-1')).toBe(false)
  })
})
