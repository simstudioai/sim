/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  launchArcsJob,
  readArcsJob,
  resolveArcsJobLink,
} from '@/lib/internal/oracle-epm-account-reconciliation/jobs'

const origin = 'https://epm.example.com'
const client = createOracleEpmClient({ instanceUrl: origin, accessToken: 'dTpw' })
const href = `${origin}/arm/rest/v1/jobs/42`
function response(status: number, extra = {}) {
  return new Response(
    JSON.stringify({
      status,
      details: status === 0 ? 'Complete' : 'Provider details',
      links: [{ rel: 'self', action: 'GET', href }],
      ...extra,
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}

describe('Account Reconciliation job behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })
  afterEach(() => vi.useRealTimers())
  it('launches without polling by default', async () => {
    mocks.fetch.mockResolvedValueOnce(response(-1))
    const result = await launchArcsJob(
      client,
      'matching',
      'runautomatch',
      { matchTypeId: 'MT' },
      {}
    )
    expect(result).toMatchObject({
      success: true,
      output: { status: -1, state: 'pending', jobId: '42', accepted: true },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('polls pending snapshots until success without relaunching the mutation', async () => {
    vi.useFakeTimers()
    mocks.fetch
      .mockResolvedValueOnce(response(-1))
      .mockResolvedValueOnce(response(-1))
      .mockResolvedValueOnce(response(0))
    const pending = launchArcsJob(
      client,
      'matching',
      'runautomatch',
      { matchTypeId: 'MT' },
      { waitForCompletion: true }
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toMatchObject({
      success: true,
      output: { state: 'succeeded', jobId: '42' },
    })
    expect(mocks.fetch.mock.calls.map((call) => call[2].method)).toEqual(['POST', 'GET', 'GET'])
  })
  it('returns failure when an accepted job subsequently fails', async () => {
    mocks.fetch.mockResolvedValueOnce(response(-1)).mockResolvedValueOnce(response(1))
    expect(
      await launchArcsJob(client, 'matching', 'runautomatch', {}, { waitForCompletion: true })
    ).toMatchObject({
      success: false,
      output: { accepted: true, jobId: '42', status: 1, state: 'failed' },
    })
  })
  it('preserves accepted job information on timeout', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementation(async () => response(-1))
    const pending = launchArcsJob(
      client,
      'matching',
      'runautomatch',
      {},
      { waitForCompletion: true, maxWaitSeconds: 5 }
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toMatchObject({
      success: false,
      output: { accepted: true, jobId: '42', state: 'pending' },
    })
    expect(mocks.fetch.mock.calls.filter((call) => call[2].method === 'POST')).toHaveLength(1)
  })
  it('preserves accepted job information on cancellation', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValueOnce(response(-1)).mockImplementationOnce(async () => {
      controller.abort(new DOMException('Cancelled', 'AbortError'))
      throw controller.signal.reason
    })
    expect(
      await launchArcsJob(
        client,
        'matching',
        'runautomatch',
        {},
        { waitForCompletion: true },
        controller.signal
      )
    ).toMatchObject({ success: false, output: { accepted: true, jobId: '42' } })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('does not retry rejected mutations', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    expect((await launchArcsJob(client, 'matching', 'runautomatch', {}, {})).success).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('preserves acceptance but never extracts IDs from invalid returned links', async () => {
    mocks.fetch.mockResolvedValueOnce(
      response(-1, {
        links: [{ rel: 'self', action: 'GET', href: 'https://attacker.example/jobs/42' }],
      })
    )
    const result = await launchArcsJob(client, 'matching', 'runautomatch', {}, {})
    expect(result).toMatchObject({ success: false, output: { accepted: true, status: -1 } })
    expect(result.output.jobId).toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('requires a status link only when a job is pending', async () => {
    mocks.fetch
      .mockResolvedValueOnce(response(-1, { links: [] }))
      .mockResolvedValueOnce(response(0, { links: [] }))
    expect((await launchArcsJob(client, 'matching', 'runautomatch', {}, {})).success).toBe(false)
    expect((await launchArcsJob(client, 'matching', 'runautomatch', {}, {})).success).toBe(true)
  })
  it('distinguishes the immediate period change from the opening-job failure', async () => {
    const complianceLink = [
      { rel: 'self', action: 'GET', href: `${origin}/armARCS/rest/v1/jobs/42` },
    ]
    mocks.fetch
      .mockResolvedValueOnce(response(-1, { links: complianceLink }))
      .mockResolvedValueOnce(response(1, { links: complianceLink }))
    const result = await launchArcsJob(
      client,
      'compliance',
      'SET_PERIOD_STATUS',
      { period: 'Jan', status: 'open' },
      { waitForCompletion: true, periodStatus: 'open' }
    )
    expect(result).toMatchObject({
      success: false,
      output: { periodStatus: 'open', accepted: true, state: 'failed', jobId: '42' },
    })
  })
  it.each(['closed', 'locked', 'pending'] as const)(
    'does not poll an immediate %s period change',
    async (periodStatus) => {
      mocks.fetch.mockResolvedValueOnce(response(0, { links: [] }))
      expect(
        await launchArcsJob(
          client,
          'compliance',
          'SET_PERIOD_STATUS',
          { period: 'Jan', status: periodStatus },
          { waitForCompletion: true, periodStatus }
        )
      ).toMatchObject({ success: true, output: { periodStatus, state: 'succeeded' } })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )
  it('preserves an already-open period when the initial opening job has failed', async () => {
    mocks.fetch.mockResolvedValueOnce(
      response(1, {
        links: [{ rel: 'Job Status', action: 'GET', href: `${origin}/armARCS/rest/v1/jobs/42` }],
      })
    )
    const result = await launchArcsJob(
      client,
      'compliance',
      'SET_PERIOD_STATUS',
      { period: 'Jan', status: 'open' },
      { periodStatus: 'open', waitForCompletion: true }
    )
    expect(result).toMatchObject({
      success: false,
      output: { status: 1, state: 'failed', accepted: true, periodStatus: 'open', jobId: '42' },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    { links: [] },
    {
      links: [
        {
          rel: 'Job Status',
          action: 'GET',
          href: 'https://attacker.example/armARCS/rest/v1/jobs/42',
        },
      ],
    },
    { links: [{ rel: 'Job Status', action: 'POST', href: `${origin}/armARCS/rest/v1/jobs/42` }] },
  ])(
    'does not claim an applied period change without a valid failed opening-job link ($links)',
    async ({ links }) => {
      mocks.fetch.mockResolvedValueOnce(response(1, { links }))
      const result = await launchArcsJob(
        client,
        'compliance',
        'SET_PERIOD_STATUS',
        { period: 'Jan', status: 'open' },
        { periodStatus: 'open' }
      )
      expect(result).toMatchObject({ success: false, output: { status: 1, state: 'failed' } })
      expect(result.output).not.toHaveProperty('accepted')
      expect(result.output).not.toHaveProperty('periodStatus')
      expect(result.output).not.toHaveProperty('jobId')
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )
  it.each([
    ['runautomatch', false, false],
    ['runautoalert', false, false],
    ['archivetransactions', true, true],
    ['purgetransactions', true, false],
    ['purgearchivetransactions', true, false],
    ['importtmpremappedtransactions', true, false],
    ['unmatchtransactions', true, false],
    ['unmatchtransactionsbyautomatch', true, false],
  ] as const)(
    'projects only documented artifacts for %s on launch and after waiting',
    async (jobName, hasLog, hasArchive) => {
      const links = [
        { rel: 'Job Status', action: 'GET', href },
        {
          rel: 'log-content',
          action: 'GET',
          href: `${origin}/rest/applicationsnapshots/log.txt/contents`,
        },
        {
          rel: 'file-content',
          action: 'GET',
          href: `${origin}/rest/applicationsnapshots/archive.zip/contents`,
        },
      ]
      for (const waitForCompletion of [false, true]) {
        mocks.fetch.mockResolvedValueOnce(response(-1, { links }))
        if (waitForCompletion) mocks.fetch.mockResolvedValueOnce(response(0, { links }))
        const result = await launchArcsJob(client, 'matching', jobName, {}, { waitForCompletion })
        expect(result.success).toBe(true)
        expect(result.output.logFileName).toBe(hasLog ? 'log.txt' : undefined)
        expect(result.output.archiveFileName).toBe(hasArchive ? 'archive.zip' : undefined)
      }
    }
  )
  it('projects validated matching artifacts without parsing counts from details', async () => {
    mocks.fetch.mockResolvedValueOnce(
      response(0, {
        details: 'Processed: 100',
        links: [
          {
            rel: 'file-content',
            action: 'GET',
            href: `${origin}/rest/applicationsnapshots/archive.zip/contents`,
          },
          {
            rel: 'log-content',
            action: 'GET',
            href: `${origin}/rest/applicationsnapshots/log.txt/contents`,
          },
        ],
      })
    )
    const result = await readArcsJob(client, 'matching', '42')
    expect(result.output).toEqual({
      status: 0,
      state: 'succeeded',
      details: 'Processed: 100',
      jobId: '42',
      archiveFileName: 'archive.zip',
      logFileName: 'log.txt',
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('prefers the documented Job Status relation over launch self links', () => {
    expect(
      resolveArcsJobLink(client, 'matching', {
        status: -1,
        links: [
          { rel: 'self', action: 'POST', href: `${origin}/arm/rest/v1/jobs` },
          { rel: 'Job Status', action: 'GET', href },
        ],
      })?.jobId
    ).toBe('42')
  })
})
