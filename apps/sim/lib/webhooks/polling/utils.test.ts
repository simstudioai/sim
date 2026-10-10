import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { authOAuthUtilsMock } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/triggers/constants', () => ({ MAX_CONSECUTIVE_FAILURES: 5 }))

import { sql } from 'drizzle-orm'
import {
  isPollBackedOff,
  PollFetchError,
  readPollRetryAfterMs,
  recordPollSourceFailure,
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

describe('poll source backoff', () => {
  const pollStartedAt = Date.parse('2026-10-09T12:00:00.000Z')
  const minutes = (count: number) => count * 60_000

  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers({ now: pollStartedAt + 30_000 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Records one source failure on a webhook whose config carries `previousFailures`, returning the merged config update. */
  async function failOnce(previousFailures: number, error: unknown = new Error('feed down')) {
    await recordPollSourceFailure(
      {
        id: 'wh-1',
        providerConfig: previousFailures ? { pollSourceFailures: previousFailures } : {},
      },
      pollStartedAt,
      error,
      'poll failed',
      logger
    )
    const merged = allInterpolatedValues().find(
      (value) => typeof value === 'string' && value.includes('pollBackoffUntil')
    )
    return JSON.parse(String(merged)) as Record<string, unknown>
  }

  it.each([
    { previousFailures: 0, waitMinutes: 1 },
    { previousFailures: 1, waitMinutes: 2 },
    { previousFailures: 4, waitMinutes: 16 },
    { previousFailures: 40, waitMinutes: 60 },
  ])(
    'after $previousFailures earlier source failures, waits about $waitMinutes minutes from the poll start',
    async ({ previousFailures, waitMinutes }) => {
      const stored = await failOnce(previousFailures)
      const waitMs = Date.parse(String(stored.pollBackoffUntil)) - pollStartedAt

      expect(stored.pollSourceFailures).toBe(previousFailures + 1)
      expect(waitMs).toBeGreaterThanOrEqual(minutes(waitMinutes) * 0.8)
      expect(waitMs).toBeLessThanOrEqual(minutes(waitMinutes) * 1.2)
    }
  )

  it('keeps a webhook backed off until its window ends', () => {
    const until = pollStartedAt + minutes(16)
    const stored = { pollBackoffUntil: new Date(until).toISOString() }

    expect(isPollBackedOff(stored, until - minutes(1))).toBe(true)
    expect(isPollBackedOff(stored, until)).toBe(false)
  })

  it("waits out a Retry-After longer than the failure backoff, counted from the source's answer", async () => {
    const stored = await failOnce(0, new PollFetchError('rate limited', 429, minutes(10)))
    expect(Date.parse(String(stored.pollBackoffUntil))).toBe(Date.now() + minutes(10))
  })

  it('ignores a missing or malformed window', () => {
    for (const config of [{}, { pollBackoffUntil: 'not-a-date' }, { pollBackoffUntil: 42 }, null]) {
      expect(isPollBackedOff(config, pollStartedAt)).toBe(false)
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
