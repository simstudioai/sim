import { createMockFetch } from '@sim/testing/mocks/fetch.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'

const { mockCollectUsageBuckets } = vi.hoisted(() => ({ mockCollectUsageBuckets: vi.fn() }))

vi.mock('@/lib/onprem-telemetry/collect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/onprem-telemetry/collect')>()),
  collectUsageBuckets: mockCollectUsageBuckets,
}))

import { runOnPremUsageReport } from '@/lib/onprem-telemetry/report'

const ENV_KEYS = [
  'ONPREM_TELEMETRY_ENABLED',
  'ONPREM_TELEMETRY_ENDPOINT',
  'ONPREM_TELEMETRY_DEPLOYMENT_ID',
  'ONPREM_TELEMETRY_API_KEY',
  'ONPREM_TELEMETRY_LOOKBACK_DAYS',
] as const

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  env.ONPREM_TELEMETRY_ENABLED = 'true'
  env.ONPREM_TELEMETRY_ENDPOINT = 'https://sim.example/'
  env.ONPREM_TELEMETRY_DEPLOYMENT_ID = 'acme-prod'
  env.ONPREM_TELEMETRY_API_KEY = 'simot_secret'
  Object.assign(env, overrides)
}

const bucket = {
  periodStart: '2026-09-26T00:00:00.000Z',
  periodEnd: '2026-09-27T00:00:00.000Z',
  workflowExecutions: 4,
  workflowExecutionsFailed: 0,
  workflowDurationMs: 100,
  credits: 4,
  inputTokens: 10,
  outputTokens: 5,
  sources: [],
  models: [],
}

describe('runOnPremUsageReport', () => {
  let fetchMock: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    for (const key of ENV_KEYS) env[key] = undefined
    fetchMock = createMockFetch({ json: { accepted: 1 } })
    vi.stubGlobal('fetch', fetchMock)
    mockCollectUsageBuckets.mockReset()
    mockCollectUsageBuckets.mockResolvedValue([bucket])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('performs no query and no request when disabled', async () => {
    const result = await runOnPremUsageReport()
    expect(result).toEqual({ status: 'disabled', reason: 'ONPREM_TELEMETRY_ENABLED is not set' })
    expect(mockCollectUsageBuckets).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a partial configuration as disabled', async () => {
    env.ONPREM_TELEMETRY_ENABLED = 'true'
    env.ONPREM_TELEMETRY_ENDPOINT = 'https://sim.example'
    const result = await runOnPremUsageReport()
    expect(result).toMatchObject({ status: 'disabled' })
    expect(result.status === 'disabled' && result.reason).toContain(
      'ONPREM_TELEMETRY_DEPLOYMENT_ID'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the trailing window with the deployment key as a bearer token', async () => {
    configure({ ONPREM_TELEMETRY_LOOKBACK_DAYS: '3' })
    const now = new Date('2026-09-27T12:00:00Z')

    const result = await runOnPremUsageReport(now)

    expect(result).toEqual({ status: 'delivered', buckets: 1, accepted: 1 })
    expect(mockCollectUsageBuckets).toHaveBeenCalledWith({
      start: new Date('2026-09-25T00:00:00Z'),
      end: new Date('2026-09-28T00:00:00Z'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://sim.example/api/onprem-telemetry/report')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer simot_secret')
    expect(JSON.parse(init?.body as string)).toEqual({
      schemaVersion: 1,
      deploymentId: 'acme-prod',
      reportedAt: now.toISOString(),
      buckets: [bucket],
    })
  })

  it('reports delivery failure without throwing', async () => {
    configure()
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(runOnPremUsageReport()).resolves.toEqual({
      status: 'failed',
      buckets: 1,
      error: 'ECONNREFUSED',
    })
  })

  it('treats a non-2xx receiver response as a failure', async () => {
    configure()
    vi.stubGlobal('fetch', createMockFetch({ status: 401, json: { error: 'nope' } }))
    await expect(runOnPremUsageReport()).resolves.toMatchObject({
      status: 'failed',
      error: 'Receiver returned HTTP 401',
    })
  })
})
