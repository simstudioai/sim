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

import {
  createTaxReportingClient,
  taxEndpoints,
  taxLinkPolicies,
} from '@/lib/internal/oracle-epm-tax-reporting/client'

const base = 'https://epm.example.com/gateway'
const auth = {
  instanceUrl: base,
  accessToken: Buffer.from('integration:password').toString('base64'),
}

describe('Tax Reporting route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(async () => Response.json({ status: 0 }))
  })

  it.each([
    ['get_api_version', {}, '/HyperionPlanning/rest/v3'],
    ['list_applications', {}, '/HyperionPlanning/rest/v3/applications'],
    [
      'get_member',
      { application: 'Tax App', dimension: 'Entity', memberName: 'North America' },
      '/HyperionPlanning/rest/v3/applications/Tax%20App/dimensions/Entity/members/North%20America',
    ],
    [
      'get_job_status',
      { application: 'Tax', jobId: '224' },
      '/HyperionPlanning/rest/v3/applications/Tax/jobs/224',
    ],
    [
      'get_fcm_job',
      { application: 'Tax', jobId: '224' },
      '/HyperionPlanning/rest/v3/applications/Tax/fcmjobs/224',
    ],
    ['get_sdm_job', { jobId: '224' }, '/HyperionPlanning/rest/sdm/v1/jobs/224'],
    ['get_report_status', { jobId: '224', module: 'FCCS' }, '/arm/rest/fcmapi/v1/job/FCCS/224'],
    [
      'get_generated_report_status',
      { jobId: '224', module: 'FCCS' },
      '/HyperionPlanning/rest/fcmapi/v1/report/job/FCCS/224',
    ],
    ['get_user_report_status', { jobId: '224' }, '/HyperionPlanning/rest/fcmapi/v1/fcm/job/224'],
    ['list_files', {}, '/interop/rest/v2/files/list'],
  ] as const)(
    'uses the exact %s route without substituting another API family',
    async (key, pathParams, path) => {
      await createTaxReportingClient(auth).request(taxEndpoints[key], { pathParams })
      expect(mocks.fetch).toHaveBeenCalledWith(
        base + path,
        '203.0.113.10',
        expect.objectContaining({ method: 'GET', maxRedirects: 0 })
      )
    }
  )

  it('encodes the whole repository path as one parameter', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('report', { headers: { 'content-type': 'text/csv' } })
    )
    const response = await createTaxReportingClient(auth).request(taxEndpoints.download_file, {
      pathParams: { fileName: 'outbox/Tax report.csv' },
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      `${base}/interop/rest/11.1.2.3.600/applicationsnapshots/outbox%2FTax%20report.csv/contents`
    )
    if ('body' in response) await response.body.cancel()
  })

  it('validates exact Job Status links and refuses other origins, relations, methods, and route families', () => {
    const client = createTaxReportingClient(auth)
    const href = `${base}/HyperionPlanning/rest/fcmapi/v1/report/job/FCCS/224`
    expect(
      client.validateReturnedLink(taxLinkPolicies.reportJob, {
        rel: 'Job Status',
        href,
        method: 'GET',
      })
    ).toBeDefined()
    for (const link of [
      { rel: 'job status', href },
      { rel: 'Job Status', href, method: 'POST' },
      { rel: 'Job Status', href: href.replace('epm.example.com', 'other.example.com') },
      { rel: 'Job Status', href: `${base}/arm/rest/fcmapi/v1/job/FCCS/224` },
      { rel: 'Job Status', href: href.replace('/gateway', '') },
    ])
      expect(() => client.validateReturnedLink(taxLinkPolicies.reportJob, link)).toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('never retries a failed mutation submission', async () => {
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 503 }))
    await expect(
      createTaxReportingClient(auth).request(taxEndpoints.submit_job, {
        pathParams: { application: 'Tax' },
        json: { jobType: 'RULES', jobName: 'Tax Rule' },
      })
    ).rejects.toThrow()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects upload directory traversal at the declared endpoint boundary', async () => {
    await expect(
      createTaxReportingClient(auth).request(taxEndpoints.upload_file, {
        pathParams: { fileName: 'tax.csv' },
        query: { extDirPath: 'inbox/../outbox' },
        stream: Buffer.from('tax'),
      })
    ).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
