/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), validate: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.validate,
}))

import { getOracleEpmEndpoint } from '@/lib/internal/oracle-epm/endpoint'
import {
  oracleEpmDataEndpoints as endpoints,
  ORACLE_EPM_DATA_MAX_ITEMS,
  oracleEpmDataClient,
  oracleEpmDataConnectionsSchema,
  oracleEpmDataFilesSchema,
  oracleEpmDataJobSchema,
  oracleEpmDataStatusSchema,
  projectOracleEpmDataResult,
} from '@/lib/internal/oracle-epm-data/contracts'

const auth = {
  oauthCredential: 'credential',
  accessToken: Buffer.from('synthetic:secret').toString('base64'),
  instanceUrl: 'https://epm.example.com/gateway/test',
}

describe('Data Integration foundation contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validate.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(
      async () => new Response('file', { headers: { 'Content-Type': 'application/octet-stream' } })
    )
  })

  it.each([
    ['listConnections', 'GET', 'V1', ['aif', 'rest']],
    ['getConnection', 'GET', 'V1', ['aif', 'rest']],
    ['updateConnection', 'PUT', 'V1', ['aif', 'rest']],
    ['getPipeline', 'GET', 'V1', ['aif', 'rest']],
    ['submitJob', 'POST', 'V1', ['aif', 'rest']],
    ['getJob', 'GET', 'V1', ['aif', 'rest']],
    ['snapshot', 'POST', 'V1', ['aif', 'rest']],
    ['getPov', 'GET', 'V1', ['aif', 'rest']],
    ['setPov', 'POST', 'V1', ['aif', 'rest']],
    ['listFiles', 'GET', 'v2', ['interop', 'rest']],
    ['deleteFile', 'DELETE', 'v2', ['interop', 'rest']],
    ['uploadFile', 'POST', '11.1.2.3.600', ['interop', 'rest']],
    ['downloadFile', 'GET', '11.1.2.3.600', ['interop', 'rest']],
  ] as const)(
    'declares the exact %s route and bounded transport',
    (name, method, version, context) => {
      const declaration = getOracleEpmEndpoint(endpoints[name])
      expect(declaration).toMatchObject({ method, version, routeSpace: { context } })
      expect(declaration.maxResponseBytes).toBeGreaterThan(0)
      expect(declaration.timeoutMs).toBeGreaterThan(0)
      expect(declaration.retry).toBeUndefined()
    }
  )

  it.each([
    ['outbox/é space.csv', 'outbox%2F%C3%A9%20space.csv'],
    ['outbox\\folder\\map.csv', 'outbox%5Cfolder%5Cmap.csv'],
    ['outbox/100%.csv', 'outbox%2F100%25.csv'],
  ])('encodes the complete raw repository filename once: %s', async (fileName, encoded) => {
    const response = await oracleEpmDataClient(auth).request(endpoints.downloadFile, {
      pathParams: { fileName },
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      `https://epm.example.com/gateway/test/interop/rest/11.1.2.3.600/applicationsnapshots/${encoded}/contents`
    )
    if ('body' in response) await response.body.cancel()
  })

  it('keeps ordinary connection identifiers and the gateway route strict', async () => {
    await expect(
      oracleEpmDataClient(auth).request(endpoints.getConnection, {
        pathParams: { connectionName: 'a/b' },
      })
    ).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('normalizes documented numeric strings without inventing missing job IDs', () => {
    expect(oracleEpmDataJobSchema.parse({ status: '-1', jobId: 42, outputFileName: null })).toEqual(
      { status: -1, jobId: '42', details: null, outputFileName: null }
    )
    expect(oracleEpmDataJobSchema.safeParse({ status: 0 }).success).toBe(false)
    for (const status of ['', 'SUCCESS', null, 1.5, '1e3'])
      expect(oracleEpmDataStatusSchema.safeParse(status).success).toBe(false)
    expect(oracleEpmDataStatusSchema.parse(2147483647)).toBe(2147483647)
  })

  it('accepts nullable LCM metadata but rejects malformed documented collection items', () => {
    expect(
      oracleEpmDataFilesSchema.parse({
        status: 0,
        items: [{ name: 'snapshot', type: 'LCM', size: null, lastmodifiedtime: null }],
      }).items
    ).toHaveLength(1)
    expect(
      oracleEpmDataConnectionsSchema.safeParse({
        status: 0,
        response: [{ name: 'not-a-documented-field' }],
      }).success
    ).toBe(false)
    expect(
      oracleEpmDataConnectionsSchema.safeParse({
        status: 0,
        response: Array.from({ length: ORACLE_EPM_DATA_MAX_ITEMS + 1 }, () => ({
          connectionName: 'test',
          refUrl: '/unused',
        })),
      }).success
    ).toBe(false)
  })

  it('reports provider errors inside HTTP 200 without requiring success-only fields', () => {
    expect(
      projectOracleEpmDataResult(
        { status: 200, data: { status: 1, details: 'Synthetic error' } },
        oracleEpmDataConnectionsSchema,
        (value) => value
      )
    ).toMatchObject({ success: false, retryable: false, output: { httpStatus: 200, status: 1 } })
  })
})
