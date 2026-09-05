/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), validate: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.validate,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { getOracleEpmEndpoint } from '@/lib/internal/oracle-epm/endpoint'
import {
  PLANNING_INLINE_BYTES,
  PLANNING_UPLOAD_CHUNK_BYTES,
  planningEndpoints,
  planningLinkPolicies,
} from '@/lib/internal/oracle-epm-planning/route-space'

const auth = {
  instanceUrl: 'https://epm.example.com/gateway/team',
  accessToken: Buffer.from('test:fixture').toString('base64'),
}
describe('Planning product route policies (foundation client precedent)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
    )
  })
  it('preserves the gateway and encodes names once', async () => {
    await createOracleEpmClient(auth).request(planningEndpoints.member, {
      pathParams: { application: 'Plan & Co', dimension: 'Account', memberName: 'Sales #1' },
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/team/HyperionPlanning/rest/v3/applications/Plan%20%26%20Co/dimensions/Account/members/Sales%20%231'
    )
  })
  it('encodes the complete repository path as one segment', async () => {
    await createOracleEpmClient(auth).request(planningEndpoints.uploadControl, {
      pathParams: { fileName: 'inbox/import.csv' },
      query: { q: JSON.stringify({ isFirst: true, isLast: false, chunkSize: 14, fileSize: '5' }) },
      headers: { contentType: 'application/octet-stream' },
    })
    expect(new URL(mocks.fetch.mock.calls[0][0]).pathname).toBe(
      '/gateway/team/interop/rest/v1/applicationsnapshots/inbox%2Fimport.csv/contents'
    )
    const query = new URL(mocks.fetch.mock.calls[0][0]).searchParams
    expect([...query.keys()]).toEqual(['q'])
    expect(JSON.parse(query.get('q')!)).toEqual({
      isFirst: true,
      isLast: false,
      chunkSize: 14,
      fileSize: '5',
    })
  })
  it('declares bounded bodies and no mutation replay', () => {
    for (const endpoint of Object.values(planningEndpoints)) {
      const definition = getOracleEpmEndpoint(endpoint)
      expect(definition.retry).toBeUndefined()
      if (definition.response === 'json')
        expect(definition.maxResponseBytes).toBeLessThanOrEqual(PLANNING_INLINE_BYTES)
      if (definition.body !== 'none')
        expect(definition.maxRequestBytes).toBeLessThanOrEqual(PLANNING_INLINE_BYTES)
    }
    expect(PLANNING_UPLOAD_CHUNK_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024)
    expect(getOracleEpmEndpoint(planningEndpoints.cleanupDownload)).toMatchObject({
      method: 'DELETE',
      body: 'none',
      timeoutMs: 5000,
    })
  })
  it.each([
    'https://attacker.example.com/gateway/team/interop/rest/v2/status/download/42',
    'https://epm.example.com/interop/rest/v2/status/download/42',
    ' https://epm.example.com/gateway/team/interop/rest/v2/status/download/42',
    'https://epm.example.com/gateway/team/interop/rest/v2/status/download/42?redirect=true',
    'https://epm.example.com/gateway/team/interop/rest/v1/status/download/42',
  ])('rejects unsafe or malformed returned status link %s', (href) => {
    expect(() =>
      createOracleEpmClient(auth).validateReturnedLink(planningLinkPolicies.downloadStatus, {
        rel: 'Job Status',
        href,
        method: 'GET',
      })
    ).toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('accepts only the documented link relation and method', () => {
    const client = createOracleEpmClient(auth)
    const href = 'https://epm.example.com/gateway/team/interop/rest/v2/status/download/42'
    expect(() =>
      client.validateReturnedLink(planningLinkPolicies.downloadStatus, {
        rel: 'Job Status',
        href,
        method: 'GET',
      })
    ).not.toThrow()
    expect(() =>
      client.validateReturnedLink(planningLinkPolicies.downloadStatus, {
        rel: "Job' 'Status",
        href,
        method: 'GET',
      })
    ).toThrow()
    expect(() =>
      client.validateReturnedLink(planningLinkPolicies.downloadStatus, {
        rel: 'Job Status',
        href,
        method: 'POST',
      })
    ).toThrow()
  })
  it('rejects undeclared path/query inputs before networking', async () => {
    await expect(
      createOracleEpmClient(auth).request(planningEndpoints.cubes, {
        pathParams: { application: 'Vision', extra: 'x' },
      })
    ).rejects.toThrow()
    await expect(
      createOracleEpmClient(auth).request(planningEndpoints.dimensions, {
        pathParams: { application: 'Vision', cube: 'Plan1' },
        query: { limit: -1 },
      })
    ).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
