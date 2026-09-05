/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  executeOracleEpcmJobOperation,
  oracleEpcmChildJobIds,
} from '@/lib/internal/oracle-epm-enterprise-profitability/jobs'

const params = {
  oauthCredential: 'credential-1',
  accessToken: Buffer.from('test-user:test-password').toString('base64'),
  instanceUrl: 'https://epm.example.com/gateway',
  applicationName: 'Profitability',
  jobId: '123',
}
const childUrl =
  'https://epm.example.com/gateway/HyperionPlanning/rest/v3/applications/Profitability/jobs/123/childjobs/12/details'
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('Oracle EPCM job monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(() => json({ jobId: 123, status: 0 }))
  })
  it.each([-1, 0, 1, 2, 3, 4, 2_147_483_647])(
    'reports documented status %s without replay',
    async (status) => {
      mocks.fetch.mockImplementation(() => json({ jobID: 123, status, details: null }))
      expect(await executeOracleEpcmJobOperation('get_job_status', params)).toMatchObject({
        success: true,
        output: { jobId: '123', status },
      })
      expect(mocks.fetch.mock.calls[0][2].method).toBe('GET')
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )
  it('polls pending to success and returns the job ID and attempt count', async () => {
    mocks.fetch.mockImplementationOnce(() => json({ jobId: 123, status: -1 }))
    expect(
      await executeOracleEpcmJobOperation('wait_for_job', { ...params, maxWaitSeconds: 10 })
    ).toMatchObject({ success: true, output: { jobId: '123', status: 0, attempts: 2 } })
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })
  it('stops on provider failure without submitting or cancelling', async () => {
    mocks.fetch.mockImplementation(() => json({ jobId: 123, status: 1 }))
    expect(await executeOracleEpcmJobOperation('wait_for_job', params)).toMatchObject({
      success: false,
      retryable: false,
      output: { state: 'failed', attempts: 1 },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('bounds waiting and leaves the remote job alone', async () => {
    mocks.fetch.mockImplementation(() => json({ jobId: 123, status: -1 }))
    await expect(
      executeOracleEpcmJobOperation('wait_for_job', { ...params, maxWaitSeconds: 1 })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })
  it('propagates local cancellation while waiting', async () => {
    mocks.fetch.mockImplementation(() => json({ jobId: 123, status: -1 }))
    const controller = new AbortController()
    const aborted = expect(
      executeOracleEpcmJobOperation('wait_for_job', params, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    setTimeout(() => controller.abort(), 10)
    await aborted
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })
  it.each([
    { jobId: 999, status: 0 },
    { jobId: 123, status: 99 },
  ])('rejects mismatched or unknown jobs', async (body) => {
    mocks.fetch.mockImplementation(() => json(body))
    await expect(executeOracleEpcmJobOperation('wait_for_job', params)).rejects.toThrow()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('uses static job IDs independently of malformed optional links', async () => {
    mocks.fetch.mockImplementation(() =>
      json({ jobId: 123, status: 0, links: [{ rel: 'Job Status', href: 'https://evil.example/' }] })
    )
    await expect(executeOracleEpcmJobOperation('get_job_status', params)).resolves.toMatchObject({
      output: { jobId: '123' },
    })
    expect(mocks.fetch.mock.calls[0][0]).toContain('/applications/Profitability/jobs/123')
  })
  it('uses explicit diagnostic pages and the documented example filter', async () => {
    mocks.fetch.mockImplementation(() =>
      json({
        items: [
          {
            recordsRead: 8,
            recordsRejected: 1,
            recordsProcessed: 7,
            dimensionName: 'Entity',
            loadType: 'Metadata Import',
            links: [{ rel: 'child-job-details', action: 'GET', href: childUrl }],
          },
        ],
      })
    )
    const result = await executeOracleEpcmJobOperation('get_job_details', {
      ...params,
      jobType: 'IMPORT_METADATA',
      offset: '25',
      limit: '25',
      messageType: 'ERROR',
    })
    expect(result.output).toMatchObject({
      offset: 25,
      limit: 25,
      details: [{ childJobIds: ['12'], recordsRejected: 1 }],
    })
    const url = new URL(mocks.fetch.mock.calls[0][0])
    expect(url.searchParams.get('q')).toBe('{"messageType":"ERROR"}')
    expect(url.searchParams.get('offset')).toBe('25')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('reads child messages only for metadata diagnostic families', async () => {
    mocks.fetch.mockImplementation(() =>
      json({ items: [{ msgType: 'ERROR', msgCategory: 'Load', msgText: 'Invalid member' }] })
    )
    const input = { ...params, childJobId: '12', jobType: 'IMPORT_METADATA' }
    expect(await executeOracleEpcmJobOperation('get_child_job_details', input)).toMatchObject({
      output: { messages: [{ msgType: 'ERROR', msgText: 'Invalid member' }] },
    })
    expect(mocks.fetch.mock.calls[0][0]).toContain('/jobs/123/childjobs/12/details')
    await expect(
      executeOracleEpcmJobOperation('get_child_job_details', { ...input, jobType: 'Calculation' })
    ).rejects.toThrow()
  })
})

describe('Oracle EPCM returned child links', () => {
  const client = createOracleEpmClient(params)
  it('accepts validated links bound to the application and parent job', () => {
    const href = `${childUrl}?limit=10&offset=10&q=%7B%22messageType%22%3A%22ERROR%22%7D`
    expect(
      oracleEpcmChildJobIds(
        [{ href, rel: 'child-job-details', action: 'GET' }],
        client,
        'Profitability',
        '123'
      )
    ).toEqual(['12'])
  })
  it.each([
    childUrl.replace('Profitability', 'Different'),
    childUrl.replace('/jobs/123/', '/jobs/999/'),
    childUrl.replace('epm.example.com', 'evil.example.com'),
    `${childUrl}?limit=1001`,
    `${childUrl}?other=true`,
    `${childUrl}?q=%7BmessageType:ERROR%7D`,
  ])('rejects unbound or malformed links', (href) => {
    expect(() =>
      oracleEpcmChildJobIds(
        [{ href, rel: 'child-job-details', action: 'GET' }],
        client,
        'Profitability',
        '123'
      )
    ).toThrow()
  })
  it('does not reinterpret methods or invent IDs from absent links', () => {
    expect(() =>
      oracleEpcmChildJobIds(
        [{ href: childUrl, rel: 'child-job-details', action: 'POST' }],
        client,
        'Profitability',
        '123'
      )
    ).toThrow()
    expect(oracleEpcmChildJobIds(null, client, 'Profitability', '123')).toEqual([])
  })
})
