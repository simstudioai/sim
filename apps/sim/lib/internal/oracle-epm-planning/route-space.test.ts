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
  it('preserves gateway prefixes and form-encodes compound approval requests', async () => {
    const puhIdentifier = 'Forecast::"Working & Review"'
    const stream = new TextEncoder().encode(
      new URLSearchParams({ pmMembers: '"Sales & Services: Retail"' }).toString()
    )
    await createOracleEpmClient(auth).request(planningEndpoints.planningUnitActions, {
      pathParams: { application: 'Plan & Co', puhIdentifier },
      query: { q: '{"options":1}' },
      headers: { contentType: 'application/x-www-form-urlencoded' },
      stream,
    })
    const [url, , options] = mocks.fetch.mock.calls[0]
    expect(new URL(url).pathname).toBe(
      '/gateway/team/HyperionPlanning/rest/v3/applications/Plan%20%26%20Co/planningunits/Forecast%3A%3A%22Working%20%26%20Review%22/availableactions'
    )
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(new TextDecoder().decode(options.body)).toBe(
      'pmMembers=%22Sales+%26+Services%3A+Retail%22'
    )
    expect(options.maxResponseBytes).toBe(PLANNING_INLINE_BYTES)
  })
  it('rejects oversized form bodies and undeclared headers before networking', async () => {
    const client = createOracleEpmClient(auth)
    const input = {
      pathParams: { application: 'Vision', puhIdentifier: 'Forecast::Working' },
      headers: { contentType: 'application/x-www-form-urlencoded' },
    }
    await expect(
      client.request(planningEndpoints.changePlanningUnitStatus, {
        ...input,
        stream: new Uint8Array(PLANNING_INLINE_BYTES + 1),
      })
    ).rejects.toThrow()
    await expect(
      client.request(planningEndpoints.changePlanningUnitStatus, {
        ...input,
        stream: new Uint8Array(0),
        headers: { contentType: 'application/json' },
      })
    ).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('propagates cancellation before an approval mutation starts', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Stopped', 'AbortError'))
    await expect(
      createOracleEpmClient(auth).request(planningEndpoints.changePlanningUnitStatus, {
        pathParams: { application: 'Vision', puhIdentifier: 'Forecast::Working' },
        headers: { contentType: 'application/x-www-form-urlencoded' },
        stream: new Uint8Array(0),
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fetch).not.toHaveBeenCalled()
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
  it('validates the approval self link without following a form mutation', () => {
    const client = createOracleEpmClient(auth)
    const href =
      'https://epm.example.com/gateway/team/HyperionPlanning/rest/v3/applications/Vision/planningunits/Forecast%3A%3A%22Working%22/actions'
    expect(() =>
      client.validateReturnedLink(planningLinkPolicies.planningUnitStatus, {
        rel: 'self',
        method: 'POST',
        href,
      })
    ).not.toThrow()
    expect(() =>
      client.validateReturnedLink(planningLinkPolicies.planningUnitStatus, {
        rel: 'self',
        method: 'GET',
        href,
      })
    ).toThrow()
    expect(() =>
      client.validateReturnedLink(planningLinkPolicies.planningUnitStatus, {
        rel: 'self',
        method: 'POST',
        href: href.replace('/gateway/team', ''),
      })
    ).toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
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
