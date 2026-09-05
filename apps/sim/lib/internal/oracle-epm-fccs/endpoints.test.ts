/** @vitest-environment node */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { createOracleEpmClient } from '@/lib/internal/oracle-epm'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsChildJobId, fccsNextPage } from '@/lib/internal/oracle-epm-fccs/links'

const auth = {
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('user:secret').toString('base64'),
}
const route = `${auth.instanceUrl}/HyperionPlanning/rest/v3/applications/Close/jobs/42`
describe('FCCS endpoint policies and returned diagnostic links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      Response.json({ status: 0 })
    )
  })
  it('encodes raw application/member names once inside the foundation route space', async () => {
    await createOracleEpmClient(auth).request(fccsEndpoints.getMember, {
      pathParams: { application: 'Close %20', dimension: 'A & B', member: 'North %20' },
    })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0][0]).toBe(
      auth.instanceUrl +
        '/HyperionPlanning/rest/v3/applications/Close%20%2520/dimensions/A%20%26%20B/members/North%20%2520'
    )
  })
  it.each([{ limit: 1001 }, { offset: -1 }, { q: 'x'.repeat(4097) }, { unreviewed: 'value' }])(
    'rejects queries outside FCCS declarations before fetch: %j',
    async (query) => {
      await expect(
        createOracleEpmClient(auth).request(fccsEndpoints.listDimensions, {
          pathParams: { application: 'Close', cube: 'Consol' },
          query,
        })
      ).rejects.toThrow()
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )
  it('does not retry potentially non-idempotent job submission on 503', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockImplementation(async () =>
      Response.json({ details: 'secret' }, { status: 503 })
    )
    await expect(
      createOracleEpmClient(auth).request(fccsEndpoints.executeJob, {
        pathParams: { application: 'Close' },
        json: { jobType: 'RULES', jobName: 'Consolidate' },
      })
    ).rejects.toThrow('temporarily unavailable')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
  })
  it('validates diagnostic relation/route capabilities before exposing IDs or next offsets', () => {
    const client = createOracleEpmClient(auth)
    expect(
      fccsChildJobId(
        client,
        [{ rel: 'child-job-details', href: `${route}/childjobs/7/details`, action: 'GET' }],
        { application: 'Close', jobId: '42' }
      )
    ).toBe('7')
    expect(
      fccsNextPage(
        client,
        fccsEndpoints.getJobDetails,
        [{ rel: 'next', href: `${route}/details?offset=25&limit=25`, action: 'GET' }],
        { application: 'Close', jobId: '42', offset: 0 }
      )
    ).toEqual({ hasMore: true, nextOffset: 25 })
    expect(
      fccsNextPage(client, fccsEndpoints.getJobDetails, undefined, {
        application: 'Close',
        jobId: '42',
        offset: 0,
      })
    ).toEqual({ hasMore: false })
  })
  it.each([
    `${route.replace('epm.example.com', 'attacker.example')}/childjobs/7/details`,
    `${route.replace('/gateway', '')}/childjobs/7/details`,
    `${route.replace('/jobs/42', '/jobs/99')}/childjobs/7/details`,
    `${route.replace('/applications/Close', '/applications/Other')}/childjobs/7/details`,
  ])('rejects unrelated child-job links %s', (href) => {
    expect(() =>
      fccsChildJobId(createOracleEpmClient(auth), [{ rel: 'child-job-details', href }], {
        application: 'Close',
        jobId: '42',
      })
    ).toThrow()
  })
  it('rejects a next link that repeats a page or belongs to another child job', () => {
    const client = createOracleEpmClient(auth)
    expect(() =>
      fccsNextPage(
        client,
        fccsEndpoints.getJobDetails,
        [{ rel: 'next', href: `${route}/details?offset=25` }],
        { application: 'Close', jobId: '42', offset: 25 }
      )
    ).toThrow()
    expect(() =>
      fccsNextPage(
        client,
        fccsEndpoints.getChildJobDetails,
        [{ rel: 'next', href: `${route}/childjobs/8/details?offset=25` }],
        { application: 'Close', jobId: '42', childJobId: '7', offset: 0 }
      )
    ).toThrow()
  })
})
