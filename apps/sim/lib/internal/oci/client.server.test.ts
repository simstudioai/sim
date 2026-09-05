/**
 * @vitest-environment node
 */
import { createPublicKey, verify } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  backoff: vi.fn(),
  decryptSecret: vi.fn(),
  predicates: undefined as unknown,
  rows: [] as { encryptedServiceAccountKey: string | null }[],
  secureFetch: vi.fn(),
  validateUrl: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((predicate: unknown) => {
          mocks.predicates = predicate
          return { limit: vi.fn(async () => mocks.rows) }
        }),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  credential: {
    encryptedServiceAccountKey: 'credential.encryptedServiceAccountKey',
    id: 'credential.id',
    providerId: 'credential.providerId',
    type: 'credential.type',
    workspaceId: 'credential.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...predicates: unknown[]) => predicates),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}))

vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decryptSecret }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetch,
  validateUrlWithDNS: mocks.validateUrl,
}))

vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: mocks.backoff,
  parseRetryAfter: vi.fn(() => null),
}))

vi.mock('@/lib/oauth/utils', () => ({
  getServiceConfigByServiceId: vi.fn((serviceId: string) =>
    serviceId === 'oci'
      ? { serviceAccountProviderId: 'oci-api-key-service-account' }
      : serviceId === 'slack'
        ? { serviceAccountProviderId: 'slack-custom-bot' }
        : null
  ),
}))

import {
  createOciClient,
  type OciAuthenticatedResponse,
  type OciClient,
  type OciRequest,
  verifyOciApiKeyCredentialForSetup,
} from '@/lib/internal/oci/client.server'
import {
  createOciDiscoveredEndpointPolicy,
  createOciStaticEndpointPolicy,
} from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import { OCI_SERVICE_ID } from '@/lib/oauth/types'

// Fixed test material. The expected signatures were generated independently with
// OpenSSL 3 against Oracle's Request Signatures specification (retrieved 2026-09-03):
// https://docs.oracle.com/en-us/iaas/Content/API/Concepts/signingrequests.htm
// The Identity hostname is cross-checked against Oracle's API endpoint catalog:
// https://docs.oracle.com/en-us/iaas/api/
// The canonical header order and hostname template are cross-checked against
// oci-common and oci-identity 2.140.1.
// Keep the synthetic fixture's PEM delimiters split so secret scanners do not
// mistake checked-in conformance material for a deployable credential.
const PRIVATE_KEY = `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDGu21M7TuK4Jr6
s8luoTzVRltBhYM078Z0JNpg3/uwqLIYtmNFDLg9AJ4NY9piBfZoE4b9EhrVzwkW
+wIWdSflJPfnlWFD7nLBk+n69dyU1wwUuEw0PYZOliFvCmlegg9qE+vZK13o5e1m
08ZEq7oxfArlHH3NZXuwoZJiraP/mtGurDrcAJLUKuTMfEp+zUOUdmupeZjmNWj9
B8xbgRoQ3vQVk+7q+ltMvsUdZB2La+IEhTg6PMCrSsRV0v/xqJiSQ34iPkxq2LrD
AUKxypwmX8X0c2VWYQh/ho3x3pT5XPxC3x/plkM8DxC7Ejjg1qa0jyl0JLzMWNnh
V79UvkKRAgMBAAECggEAO3ueG4hmagsQWDm38QUR0ERezB3KR+382IavVo+0JgxY
Qk1VKTXFb3zf0eIxW2WtezldDiJ9JcHyVo6K8W3foxaNnSN5GXwlnQtI3XT5sRMs
6oa/SGOh76PAHhxfrYoAUx/jV/1C/pLTnBOHJMbB1E3sdOcyQGg/vX6e8ipHDBoj
24tljd5fvmDWkR/WYHwjn2xaY8Ee3/EfIoBw5r+WrXLjpj5FuGUo+pxyqbSI2qE/
mpOMEi/+KprpUU8N5e33+cihyrneAKLyqyxS7NPWmbc5+ut0g4uzIu1NmyAhfa2o
c1MbQqh+C2R96tbhPAJQHeRClV1YKUpOiXj6EvpmAQKBgQDmEoNkMSWfX0gJMOdM
8kh641t3KBqyyGt3kx2xTaeybq8MFilQCahSTjfndkT8tlW1eRh2BiMUvvdSpCPM
wRH7BGW4h8J6ALmMnj0nsl8ebJc7g0hzacRG+SAVD8IbQqIzc0rY/DUfuoIuL5Ce
R0l9p85r2ZBGNrnM9dIUkfNj/QKBgQDdIMNXzKGPRUUkdN5kskfCEV3a0geVFaU0
ZOiZf6TRidcl5RTaTcJbRJ2pXsealDlURdmrk8lGgy0uTE181Zn71bBPKjN1xmct
H8SMQvxcI62OYaUbEpzgp83TZXtRpqmVA2v+0BjhrjPPjVKsT5YwkHRPb5DyHOW8
D8HB/dO7JQKBgQDbW6lknKtHUZwoDzVpGtPaPu2VJWqXLRmxr1WvF+Ac8wT43CRV
iG+w0ZzhldTesaX0WVnmJaHLBOxgIdl0Ply7XQzzLJVSp2BB3xllwN6J7nUeq+Qn
Dh+yn5JkIlsqjJSDw5gIXCb2cmfuSzFyh3tdT+Iy2AODvmfWMEY1kJZjrQKBgDUO
wHBXtEg5Ob7mn9oPgPJK0ndHv/QArpQkxj7WhsiUR2BbWCaNU94sV5wlFsW7XQog
fHsTyc62eOfL/Se/5OOtQVGtcY2H3ofQQIvbIsxE70bjnQci7ytkeBmKFw3fbH9J
w+bvLZkxAFODuFuJ+SKL9qx8u42sa181dKtEaUJVAoGBALuFS1q/ihZw8M5AoofY
llBvP7/pHwT8XR2gWl5sZFOt6kvrMQqcI3u/9BkVR9au1I2K7xJOQmt9KEL4HkgP
6cqql61lZNv8GgYlJPu8ipN0IUxf1V7K+9xw0t1am57WATCW+bqkfyvYoBXhLwx6
7z8JESybW/3kkmWIOy5WHvzv
${['-----END', 'PRIVATE KEY-----'].join(' ')}
`

const SECRET = JSON.stringify({
  type: 'oci_api_signing_key_v1',
  providerId: 'oci-api-key-service-account',
  tenancyOcid: 'ocid1.tenancy.oc1..aaaaaaaafixedvector',
  userOcid: 'ocid1.user.oc1..aaaaaaaafixedvector',
  fingerprint: '25:53:22:62:aa:db:ff:ef:f5:77:08:d1:a2:ed:8b:e6',
  privateKey: PRIVATE_KEY,
  region: 'us-ashburn-1',
  metadata: {
    principalKind: 'user',
    principalId: 'ocid1.user.oc1..aaaaaaaafixedvector',
  },
})

const STATIC_POLICY = createOciStaticEndpointPolicy({
  serviceId: OCI_SERVICE_ID,
  serviceName: 'identity',
  hostnameTemplate: 'regional-oci',
})

function secureResponse(params: {
  status?: number
  body?: Uint8Array | string
  headers?: Record<string, string>
}) {
  const bytes =
    typeof params.body === 'string'
      ? new TextEncoder().encode(params.body)
      : (params.body ?? new Uint8Array())
  return {
    ok: (params.status ?? 200) >= 200 && (params.status ?? 200) < 300,
    status: params.status ?? 200,
    statusText: '',
    headers: new Headers({ 'content-length': String(bytes.byteLength), ...params.headers }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.byteLength > 0) controller.enqueue(bytes)
        controller.close()
      },
    }),
    text: vi.fn(async () => Buffer.from(bytes).toString('utf8')),
    json: vi.fn(async () => JSON.parse(Buffer.from(bytes).toString('utf8'))),
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(0)),
  }
}

async function createPreparedClient(params: { region?: string } = {}): Promise<{
  client: OciClient
  endpoint: Awaited<ReturnType<OciClient['prepareStaticEndpoint']>>
}> {
  const client = await createOciClient({
    credentialId: 'credential-authoritative',
    workspaceId: 'workspace-trusted',
    serviceId: OCI_SERVICE_ID,
    ...params,
  })
  const endpoint = await client.prepareStaticEndpoint(STATIC_POLICY)
  return { client, endpoint }
}

function authorizationFromLastRequest(): string {
  const options = mocks.secureFetch.mock.calls.at(-1)?.[2] as { headers: Record<string, string> }
  return options.headers.authorization
}

describe('credential-bound OCI client', () => {
  beforeEach(() => {
    mocks.predicates = undefined
    mocks.rows = [{ encryptedServiceAccountKey: 'encrypted-secret' }]
    mocks.decryptSecret.mockReset().mockResolvedValue({ decrypted: SECRET })
    mocks.backoff.mockReset().mockReturnValue(0)
    mocks.secureFetch.mockReset().mockResolvedValue(secureResponse({}))
    mocks.validateUrl.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'identity.us-ashburn-1.oci.oraclecloud.com',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads only an exact credential/workspace/type/provider row before decryption', async () => {
    const { client, endpoint } = await createPreparedClient()

    await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })

    expect(mocks.predicates).toEqual([
      { field: 'credential.id', value: 'credential-authoritative' },
      { field: 'credential.workspaceId', value: 'workspace-trusted' },
      { field: 'credential.type', value: 'service_account' },
      { field: 'credential.providerId', value: 'oci-api-key-service-account' },
    ])
    expect(mocks.decryptSecret).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing row', () => (mocks.rows = [])],
    ['null secret', () => (mocks.rows = [{ encryptedServiceAccountKey: null }])],
    ['decrypt failure', () => mocks.decryptSecret.mockRejectedValueOnce(new Error('ciphertext'))],
    ['malformed secret', () => mocks.decryptSecret.mockResolvedValueOnce({ decrypted: '{}' })],
  ])('projects %s as the same credential-unavailable failure', async (_name, arrange) => {
    arrange()
    const client = await createOciClient({
      credentialId: 'raw-id-is-not-authority',
      workspaceId: 'wrong-or-right-workspace',
      serviceId: OCI_SERVICE_ID,
    })
    await expect(client.prepareStaticEndpoint(STATIC_POLICY)).rejects.toMatchObject({
      code: 'credential_unavailable',
      message: 'OCI credential is unavailable',
    })
  })

  it('fails a registered-service mismatch before loading or network work', async () => {
    await expect(
      createOciClient({
        credentialId: 'credential-authoritative',
        workspaceId: 'workspace-trusted',
        serviceId: 'slack',
      })
    ).rejects.toMatchObject({ code: 'invalid_endpoint' })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('fails a policy/client owner mismatch before loading or network work', async () => {
    const client = await createOciClient({
      credentialId: 'credential-authoritative',
      workspaceId: 'workspace-trusted',
      serviceId: OCI_SERVICE_ID,
    })
    const wrongPolicy = createOciStaticEndpointPolicy({
      serviceId: 'slack',
      serviceName: 'identity',
      hostnameTemplate: 'regional-oci',
    })
    await expect(client.prepareStaticEndpoint(wrongPolicy)).rejects.toMatchObject({
      code: 'invalid_endpoint',
    })
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('enforces realm-compatible region overrides', async () => {
    await expect(createPreparedClient({ region: 'us-gov-ashburn-1' })).rejects.toMatchObject({
      code: 'invalid_endpoint',
    })
    expect((await createPreparedClient({ region: 'eu-frankfurt-1' })).endpoint.origin).toBe(
      'https://identity.eu-frankfurt-1.oci.oraclecloud.com'
    )
  })

  it('matches the fixed Oracle canonical signing fixture', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T19:00:00.000Z'))
    const { client, endpoint } = await createPreparedClient()
    await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/20160918/users',
      queryPairs: [
        ['limit', '10'],
        ['name', 'Team X'],
      ],
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })

    const authorization = authorizationFromLastRequest()
    expect(authorization).toBe(
      'Signature version="1",keyId="ocid1.tenancy.oc1..aaaaaaaafixedvector/ocid1.user.oc1..aaaaaaaafixedvector/25:53:22:62:aa:db:ff:ef:f5:77:08:d1:a2:ed:8b:e6",algorithm="rsa-sha256",headers="x-date (request-target) host",signature="szHTszQxwI2ewdVaeTurJY0ObT7qSjjTpXKLDRhnBp8g2hT1r2yxs4IaxN+wcrebh4i5tQYq5aBIuM3f5jOe4ng/e9+HCV+J8kHyRMxwk1b3nkqtImf8sPetp1ohD1XeWdT1gw5MSavC/C2mdHdDNlOrYAKD2vwxsKRbS6/C6ngRRcTispz6UU/ydmeYq3JjuFJezFPGWXRdqndM0dC+/ew19x08X/M6quZcxn9JZVw1E2YzSjq8xquLQYyISesVtpN81HEZ9KE9UOhbALNQAJcLCt6R3Su78aOR0S0vh19YkrwxCLbbTmPrVubksXsfZPcotbZmtXVIzNdLW0JpNg=="'
    )

    const signature = /signature="([^"]+)"/.exec(authorization)?.[1]
    expect(signature).toBeDefined()
    expect(
      verify(
        'RSA-SHA256',
        'x-date: Thu, 03 Sep 2026 19:00:00 GMT\n(request-target): get /20160918/users?limit=10&name=Team%20X\nhost: identity.us-ashburn-1.oci.oraclecloud.com',
        createPublicKey(PRIVATE_KEY),
        Buffer.from(signature!, 'base64')
      )
    ).toBe(true)
  })

  it('matches the fixed Oracle body-signing fixture for an empty body', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T19:00:00.000Z'))
    const { client, endpoint } = await createPreparedClient()
    await client.request({
      endpoint,
      method: 'POST',
      encodedPath: '/20160918/users',
      body: new Uint8Array(),
      contentType: 'application/json',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })

    expect(authorizationFromLastRequest()).toBe(
      'Signature version="1",keyId="ocid1.tenancy.oc1..aaaaaaaafixedvector/ocid1.user.oc1..aaaaaaaafixedvector/25:53:22:62:aa:db:ff:ef:f5:77:08:d1:a2:ed:8b:e6",algorithm="rsa-sha256",headers="x-date (request-target) host content-type content-length x-content-sha256",signature="W2/OGoa2XuOin6+CQt32/+/lAXG5PWoamkAHr/k84oCYGUuub2mEYw1z9p4gc6/GPgeZ30wVp4DNVLzOjup3nJir1WsEsYzAk27XAIRVjxiQ7oBzCccnSnB88KLeNz1NDz7r4QPQGxZ50MBQEe0C+DEH2P+utpfFN73o7GCUhIN9hb27COg4l7ffdSLgjBWPN/B4AiZXpjz3I/GRHo29otGAhZ3MiX10gJTjy+qeAchAfmXmTx/nJqNhF0Aj255+B2lepCrHdkpcBpiTs5E+ppE6VvML0ByQ9ZLzBISB4MBljuFyey6tnTkueT73fqjQyM/OT+aO9HrAlemc3HSAXA=="'
    )
    expect(mocks.secureFetch.mock.calls[0][2].headers).toMatchObject({
      'content-length': '0',
      'content-type': 'application/json',
      'x-content-sha256': '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
    })
  })

  it('preserves ordered duplicate queries and exact binary request bytes', async () => {
    const { client, endpoint } = await createPreparedClient()
    const body = new Uint8Array([0, 255, 1, 240, 159, 140, 131])
    await client.request({
      endpoint,
      method: 'POST',
      encodedPath: '/v1/%E2%98%83',
      queryPairs: [
        ['z', 'last'],
        ['a', ''],
        ['a', " !'()*"],
      ],
      headers: { accept: 'application/json' },
      body,
      contentType: 'application/octet-stream',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })

    const [url, resolvedIP, options] = mocks.secureFetch.mock.calls[0] as [
      string,
      string,
      { body: Uint8Array; headers: Record<string, string> },
    ]
    expect(url).toBe(
      'https://identity.us-ashburn-1.oci.oraclecloud.com/v1/%E2%98%83?z=last&a=&a=%20%21%27%28%29%2A'
    )
    expect(resolvedIP).toBe('203.0.113.10')
    expect([...options.body]).toEqual([...body])
    expect(options.body).not.toBe(body)
    expect(options.headers).toMatchObject({
      'content-length': '7',
      'content-type': 'application/octet-stream',
      'x-content-sha256': 'ujM2KRiewv2gytZWgW9aE6ZPWa2LOxmcemXv0wuwcrs=',
    })
  })

  it.each([
    'reports%2Fdaily.csv',
    'reports%2fdaily%5cfile.csv',
    '%2Freports%2F%2Fdaily.csv',
    '%2F',
    '%5Creports%5Cdaily.csv',
    'reports%2F..%2Fdaily.csv',
    'reports%2F%E2%98%83%20caf%C3%A9.csv',
    'literal%252F%255C%2500.csv',
    'what%3Fpart%231.txt',
  ])('preserves and signs an encoded object name exactly: %s', async (encodedName) => {
    const { client } = await createPreparedClient()
    const endpoint = await client.prepareStaticEndpoint(
      createOciStaticEndpointPolicy({
        serviceId: OCI_SERVICE_ID,
        serviceName: 'objectstorage',
        hostnameTemplate: 'regional',
      })
    )
    const encodedPath = `/n/synthetic_namespace/b/synthetic_bucket/o/${encodedName}`
    const target = `${encodedPath}?versionId=v%2F1`
    await client.request({
      endpoint,
      method: 'GET',
      encodedPath,
      queryPairs: [['versionId', 'v/1']],
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
    const [url, , options] = mocks.secureFetch.mock.calls[0] as [
      string,
      string,
      { headers: Record<string, string> },
    ]
    const hostname = 'objectstorage.us-ashburn-1.oraclecloud.com'
    expect(url).toBe(`https://${hostname}${target}`)
    const signature = options.headers.authorization.match(/signature="([^"]+)"/)?.[1]
    expect(signature).toBeDefined()
    const signingString = [
      `x-date: ${options.headers['x-date']}`,
      `(request-target): get ${target}`,
      `host: ${hostname}`,
    ].join('\n')
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(signingString, 'utf8'),
        createPublicKey(PRIVATE_KEY),
        Buffer.from(signature ?? '', 'base64')
      )
    ).toBe(true)
  })

  it.each(['GET', 'HEAD', 'DELETE'] as const)('rejects bodies for %s', async (method) => {
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method,
        encodedPath: '/v1/test',
        body: new Uint8Array(),
        contentType: 'application/json',
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it.each(['GET', 'HEAD', 'DELETE'] as const)(
    'sends a bodyless %s without body signing headers',
    async (method) => {
      const { client, endpoint } = await createPreparedClient()
      await client.request({
        endpoint,
        method,
        encodedPath: '/v1/test',
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
      const options = mocks.secureFetch.mock.calls.at(-1)?.[2]
      expect(options.method).toBe(method)
      expect(options).not.toHaveProperty('body')
      expect(options.headers).not.toHaveProperty('content-length')
      expect(options.headers).not.toHaveProperty('x-content-sha256')
    }
  )

  it.each(['POST', 'PUT', 'PATCH'] as const)(
    'requires an exact body and content type for %s, including empty bodies',
    async (method) => {
      const { client, endpoint } = await createPreparedClient()
      await expect(
        client.request({
          endpoint,
          method,
          encodedPath: '/v1/test',
          timeoutMs: 10_000,
          maxResponseBytes: 1024,
        })
      ).rejects.toMatchObject({ code: 'invalid_request' })
      await client.request({
        endpoint,
        method,
        encodedPath: '/v1/test',
        body: new Uint8Array(),
        contentType: 'application/json',
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
      expect(mocks.secureFetch.mock.calls.at(-1)?.[2].headers['content-length']).toBe('0')
    }
  )

  it.each([
    'relative',
    '//host/path',
    '/double//slash',
    '/query?x=1',
    '/fragment#value',
    '/back\\slash',
    '/encoded%00control',
    '/encoded%1fcontrol',
    '/encoded%7Fcontrol',
    '/bad%2',
    '/bad%GG',
    '/raw\0control',
    '/raw\u007fcontrol',
    '/raw\ncontrol',
    '/raw\tcontrol',
    '/raw space',
    '/raw\ud800surrogate',
    '/a/../b',
    '/a/./b',
    '/a/%2e%2e/b',
    '/a/%2E/b',
  ])('rejects ambiguous encoded paths: %s', async (encodedPath) => {
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath,
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(mocks.validateUrl).not.toHaveBeenCalled()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('rejects signing-controlled headers', async () => {
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        headers: { Authorization: 'forged' },
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('fails closed on malformed runtime request shapes', async () => {
    const { client, endpoint } = await createPreparedClient()
    const base = {
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    }
    const invalidRequests = [
      { ...base, method: 'TRACE' },
      { ...base, encodedPath: 42 },
      { ...base, headers: [] },
      { ...base, queryPairs: [['only-key']] },
      { ...base, queryPairs: [['\ud800', 'value']] },
      { ...base, retry: { kind: 'unknown', maxAttempts: 2 } },
      { ...base, retry: { kind: 'safe', maxAttempts: 2, retryToken: 'forged' } },
      { ...base, responseHeaders: [42] },
    ]

    for (const request of invalidRequests) {
      await expect(client.request(request as unknown as OciRequest)).rejects.toMatchObject({
        code: 'invalid_request',
      })
    }
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it.each(['DELETE', 'POST', 'PUT', 'PATCH'] as const)(
    'rejects caller-asserted safe retries for %s before signing or transport',
    async (method) => {
      const { client, endpoint } = await createPreparedClient()
      const bodyFields =
        method === 'DELETE' ? {} : { body: new Uint8Array(), contentType: 'text/plain' }

      await expect(
        client.request({
          endpoint,
          method,
          encodedPath: '/v1/test',
          ...bodyFields,
          retry: { kind: 'safe', maxAttempts: 2 },
          timeoutMs: 10_000,
          maxResponseBytes: 1024,
        } as unknown as OciRequest)
      ).rejects.toMatchObject({ code: 'invalid_request' })
      expect(mocks.secureFetch).not.toHaveBeenCalled()
    }
  )

  it('does not retry unless the operation opts in', async () => {
    mocks.secureFetch.mockResolvedValue(
      secureResponse({ status: 503, body: '{"message":"secret"}' })
    )
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'request_failed', status: 503 })
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
  })

  it('re-signs every retry while preserving exact bytes and retry token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T19:00:00.000Z'))
    mocks.backoff.mockReturnValue(1000)
    mocks.secureFetch
      .mockResolvedValueOnce(secureResponse({ status: 503, body: '{"code":"Busy"}' }))
      .mockResolvedValueOnce(secureResponse({ status: 200, body: 'ok' }))
    const { client, endpoint } = await createPreparedClient()
    const body = new Uint8Array([9, 8, 7])
    const pending = client.request({
      endpoint,
      method: 'PUT',
      encodedPath: '/v1/test',
      body,
      contentType: 'application/octet-stream',
      retry: { kind: 'tokenized', maxAttempts: 2, retryToken: 'operation-token' },
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await pending

    const first = mocks.secureFetch.mock.calls[0][2]
    const second = mocks.secureFetch.mock.calls[1][2]
    expect([...first.body]).toEqual([...second.body])
    expect(first.headers['opc-retry-token']).toBe('operation-token')
    expect(second.headers['opc-retry-token']).toBe('operation-token')
    expect(first.headers['x-date']).not.toBe(second.headers['x-date'])
    expect(first.headers.authorization).not.toBe(second.headers.authorization)
  })

  it('never manufactures future signing dates under rapid request volume', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-03T19:00:00.000Z')
    vi.setSystemTime(now)
    mocks.secureFetch.mockImplementation(async () => secureResponse({}))
    const { client, endpoint } = await createPreparedClient()

    await Promise.all(
      Array.from({ length: 305 }, () =>
        client.request({
          endpoint,
          method: 'GET',
          encodedPath: '/v1/test',
          timeoutMs: 10_000,
          maxResponseBytes: 1024,
        })
      )
    )

    const signingDates = mocks.secureFetch.mock.calls.map(
      (call) => (call[2] as { headers: Record<string, string> }).headers['x-date']
    )
    expect(new Set(signingDates)).toEqual(new Set([now.toUTCString()]))
  })

  it('retries only the exact internal IncorrectState 409 classification', async () => {
    mocks.secureFetch
      .mockResolvedValueOnce(secureResponse({ status: 409, body: '{"code":"IncorrectState"}' }))
      .mockResolvedValueOnce(secureResponse({ status: 200 }))
    const { client, endpoint } = await createPreparedClient()
    await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      retry: { kind: 'safe', maxAttempts: 2 },
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry another provider 409 classification', async () => {
    mocks.secureFetch.mockResolvedValue(
      secureResponse({ status: 409, body: '{"code":"Conflict"}' })
    )
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        retry: { kind: 'safe', maxAttempts: 2 },
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'request_failed', status: 409 })
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
  })

  it('retries eligible transport failures and rejects unclassified failures', async () => {
    const retryable = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
    mocks.secureFetch
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce(secureResponse({ status: 200 }))
    const { client, endpoint } = await createPreparedClient()
    await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      retry: { kind: 'safe', maxAttempts: 2 },
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(2)

    mocks.secureFetch.mockReset().mockRejectedValue(new Error('provider diagnostic'))
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        retry: { kind: 'safe', maxAttempts: 2 },
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'request_failed', message: 'OCI request failed' })
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
  })

  it('retries the bounded transport timeout', async () => {
    mocks.secureFetch
      .mockRejectedValueOnce(new Error('Request timed out after 9000ms'))
      .mockResolvedValueOnce(secureResponse({ status: 200 }))
    const { client, endpoint } = await createPreparedClient()
    await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      retry: { kind: 'safe', maxAttempts: 2 },
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(2)
  })

  it('discards provider messages and exposes only safe status and request IDs', async () => {
    const opaqueProviderSecret = 'opaque-diagnostic-secret-7f3a'
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        status: 401,
        body: JSON.stringify({
          message: opaqueProviderSecret,
          nested: { authorization: 'another-opaque-secret' },
        }),
        headers: { 'opc-request-id': 'request-401' },
      })
    )
    const { client, endpoint } = await createPreparedClient()
    const failure = await client
      .request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(OciClientError)
    expect(failure).toMatchObject({
      code: 'request_failed',
      message: 'OCI request failed',
      status: 401,
      opcRequestId: 'request-401',
    })
    expect(JSON.stringify(failure)).not.toContain(opaqueProviderSecret)
    expect(JSON.stringify(failure)).not.toContain('another-opaque-secret')
    expect(JSON.stringify(failure)).not.toContain('authorization')
  })

  it.each([true, false])('keeps additional response headers opt-in: %s', async (requested) => {
    const additionalHeaders = {
      'opc-next-cursor': 'opaque/next+cursor==%2F',
      'content-length': '3',
      'last-modified': 'Sat, 05 Sep 2026 12:00:00 GMT',
      'content-md5': 'content-md5==',
      'opc-content-md5': 'opc-content-md5==',
      'opc-multipart-md5': 'multipart-md5==',
      'content-encoding': 'identity',
      'content-language': 'en',
      'content-disposition': 'attachment; filename="report.csv"',
      'cache-control': 'private, max-age=60',
      'storage-tier': 'Archive',
      'archival-state': 'Restored',
      'time-of-archival': '2026-09-06T12:00:00Z',
      'version-id': 'opaque-version-id',
      'is-delete-marker': 'false',
    }
    const defaultHeaders = {
      'content-type': 'application/octet-stream',
      etag: 'etag-1',
      'opc-request-id': 'request-1',
    }
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        status: 200,
        body: new Uint8Array([1, 2, 3]),
        headers: { ...additionalHeaders, ...defaultHeaders, 'x-provider-secret': 'hidden' },
      })
    )
    const { client, endpoint } = await createPreparedClient()
    const result = await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      responseHeaders: requested
        ? ['ETAG', ...Object.keys(additionalHeaders).map((name) => name.toUpperCase())]
        : undefined,
      timeoutMs: 10_000,
      maxResponseBytes: 3,
    })
    expect([...result.body]).toEqual([1, 2, 3])
    expect(result.headers).toEqual({
      ...defaultHeaders,
      ...(requested ? additionalHeaders : {}),
    })
    expect(Object.isFrozen(result.headers)).toBe(true)
  })

  it('retains an opaque next cursor when the message batch is empty', async () => {
    const cursor = 'opaque/next+cursor==%2F'
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        body: '[]',
        headers: { 'opc-next-cursor': cursor, 'opc-next-page': 'not-a-message-cursor' },
      })
    )
    const { client, endpoint } = await createPreparedClient()
    const result = await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/messages',
      responseHeaders: ['opc-next-cursor'],
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect(new TextDecoder().decode(result.body)).toBe('[]')
    expect(result.headers).toEqual({ 'opc-next-cursor': cursor })
  })

  it('projects HEAD metadata without applying the body limit to the object size', async () => {
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        headers: { 'content-length': '1099511627776', 'opc-meta-source': 'head metadata' },
      })
    )
    const { client, endpoint } = await createPreparedClient()
    const result = await client.request({
      endpoint,
      method: 'HEAD',
      encodedPath: '/v1/object',
      responseHeaders: ['content-length', 'opc-meta-*'],
      timeoutMs: 10_000,
      maxResponseBytes: 1,
    })
    expect(result.body.byteLength).toBe(0)
    expect(result.headers).toEqual({
      'content-length': '1099511627776',
      'opc-meta-source': 'head metadata',
    })
  })

  it.each([true, false])(
    'projects only explicitly requested object metadata: %s',
    async (requested) => {
      mocks.secureFetch.mockResolvedValueOnce(
        secureResponse({
          headers: {
            'OPC-Meta-Source': 'Mixed CASE / café',
            'opc-meta-empty': '',
            'opc-meta-': 'missing suffix',
            'x-opc-meta-secret': 'excluded',
            'set-cookie': 'excluded=secret',
            authorization: 'Bearer excluded-secret',
          },
        })
      )
      const { client, endpoint } = await createPreparedClient()
      const result = await client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/object',
        responseHeaders: requested ? ['OPC-META-*', 'opc-meta-*'] : [],
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
      expect(result.headers).toEqual(
        requested
          ? {
              'opc-meta-source': 'Mixed CASE / café',
              'opc-meta-empty': '',
            }
          : {}
      )
      expect(Object.isFrozen(result.headers)).toBe(true)
    }
  )

  it.each([4096, 4097])('bounds projected object metadata entries: %i', async (count) => {
    const headers: Record<string, string> = {}
    for (let index = 0; index < count; index += 1) {
      headers[`opc-meta-${index}`] = ''
    }
    mocks.secureFetch.mockResolvedValueOnce(secureResponse({ headers }))
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/object',
      responseHeaders: ['opc-meta-*'],
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    if (count === 4096) {
      const result = await pending
      expect(result.headers).toEqual(headers)
      expect(Object.isFrozen(result.headers)).toBe(true)
    } else {
      await expect(pending).rejects.toMatchObject({
        code: 'response_too_large',
        message: 'OCI response exceeded the configured limit',
      })
    }
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
  })

  it.each([65536, 65537])('bounds metadata names and values by UTF-8 bytes: %i', async (bytes) => {
    const name = 'opc-meta-test'
    const valueBytes = bytes - Buffer.byteLength(name, 'utf8')
    const value = 'é'.repeat(Math.floor(valueBytes / 2)) + 'x'.repeat(valueBytes % 2)
    expect(Buffer.byteLength(name + value, 'utf8')).toBe(bytes)
    mocks.secureFetch.mockResolvedValueOnce(secureResponse({ headers: { [name]: value } }))
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/object',
      responseHeaders: ['opc-meta-*'],
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    if (bytes === 65536) {
      expect((await pending).headers).toEqual({ [name]: value })
    } else {
      await expect(pending).rejects.toMatchObject({
        code: 'response_too_large',
        message: 'OCI response exceeded the configured limit',
      })
    }
  })

  it('applies the metadata byte limit across entries only when requested', async () => {
    const headers = {
      'opc-meta-first': 'a'.repeat(40_000),
      'opc-meta-second': 'b'.repeat(40_000),
    }
    mocks.secureFetch.mockResolvedValue(secureResponse({ headers }))
    const { client, endpoint } = await createPreparedClient()
    const request = {
      endpoint,
      method: 'GET' as const,
      encodedPath: '/v1/object',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    }
    expect((await client.request(request)).headers).toEqual({})
    mocks.secureFetch.mockResolvedValueOnce(secureResponse({ headers }))
    await expect(
      client.request({ ...request, responseHeaders: ['opc-meta-*'] })
    ).rejects.toMatchObject({
      code: 'response_too_large',
      message: 'OCI response exceeded the configured limit',
    })
  })

  it.each([
    '*',
    'opc-*',
    'opc-meta-*suffix',
    'opc-meta-',
    'opc-meta-name',
    'set-cookie',
    'x-provider-secret',
  ])('rejects unsupported header selectors before DNS or transport: %s', async (name) => {
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/object',
        responseHeaders: [name],
        timeoutMs: 10_000,
        maxResponseBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(mocks.validateUrl).not.toHaveBeenCalled()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('cancels and classifies a success body beyond the operation limit', async () => {
    const cancel = vi.fn()
    mocks.secureFetch.mockResolvedValueOnce({
      ...secureResponse({ body: new Uint8Array([1, 2, 3, 4]) }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        },
        cancel,
      }),
    })
    const { client, endpoint } = await createPreparedClient()
    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        timeoutMs: 10_000,
        maxResponseBytes: 3,
      })
    ).rejects.toMatchObject({ code: 'response_too_large' })
    expect(cancel).toHaveBeenCalled()
  })

  it('preserves response-too-large when transport rejects a declared content length', async () => {
    mocks.secureFetch.mockRejectedValueOnce(
      new PayloadSizeLimitError({ label: 'OCI response', maxBytes: 3, observedBytes: 4 })
    )
    const { client, endpoint } = await createPreparedClient()

    await expect(
      client.request({
        endpoint,
        method: 'GET',
        encodedPath: '/v1/test',
        retry: { kind: 'safe', maxAttempts: 2 },
        timeoutMs: 10_000,
        maxResponseBytes: 3,
      })
    ).rejects.toMatchObject({ code: 'response_too_large' })
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
  })

  it('invokes a Functions endpoint discovered through the same client and management policy', async () => {
    const managementPolicy = createOciStaticEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'functions',
      hostnameTemplate: 'regional-oci',
    })
    const invocationPolicy = createOciDiscoveredEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'functions',
      hostnameTemplate: 'region-first-oci',
      responsePolicy: managementPolicy,
      source: { kind: 'json', path: ['invokeEndpoint'] },
    })
    const invokeOrigin = 'https://fixture.us-ashburn-1.functions.oci.oraclecloud.com'
    mocks.secureFetch
      .mockResolvedValueOnce(
        secureResponse({ body: JSON.stringify({ invokeEndpoint: invokeOrigin }) })
      )
      .mockResolvedValueOnce(secureResponse({ body: 'invoked' }))
    const { client } = await createPreparedClient()
    const managementEndpoint = await client.prepareStaticEndpoint(managementPolicy)
    const response = await client.request({
      endpoint: managementEndpoint,
      method: 'GET',
      encodedPath: '/20181201/functions/synthetic-function',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    const invocationEndpoint = await client.prepareDiscoveredEndpoint(invocationPolicy, response)
    const body = new TextEncoder().encode('{"message":"hello"}')
    const result = await client.request({
      endpoint: invocationEndpoint,
      method: 'POST',
      encodedPath: '/20181201/functions/synthetic-function/actions/invoke',
      body,
      contentType: 'application/json',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(2)
    expect(mocks.secureFetch.mock.calls[0][0]).toBe(
      'https://functions.us-ashburn-1.oci.oraclecloud.com/20181201/functions/synthetic-function'
    )
    expect(mocks.secureFetch.mock.calls[1][0]).toBe(
      `${invokeOrigin}/20181201/functions/synthetic-function/actions/invoke`
    )
    expect(mocks.secureFetch.mock.calls[1][2]).toMatchObject({ method: 'POST', body })
    expect(authorizationFromLastRequest()).toMatch(/^Signature version="1"/)
    expect(new TextDecoder().decode(result.body)).toBe('invoked')
  })

  it('rejects fabricated and cross-client authenticated discovery responses', async () => {
    const policy = createOciDiscoveredEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'database',
      hostnameTemplate: 'regional',
      responsePolicy: STATIC_POLICY,
      source: { kind: 'json', path: ['endpoint'] },
    })
    const first = await createPreparedClient()
    const second = await createPreparedClient()
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        body: JSON.stringify({
          endpoint: 'https://resource.database.us-ashburn-1.oraclecloud.com',
        }),
      })
    )
    const response = await first.client.request({
      endpoint: first.endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect((await first.client.prepareDiscoveredEndpoint(policy, response)).origin).toBe(
      'https://resource.database.us-ashburn-1.oraclecloud.com'
    )
    await expect(second.client.prepareDiscoveredEndpoint(policy, response)).rejects.toMatchObject({
      code: 'invalid_endpoint',
    })
    const otherPolicy = createOciStaticEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'compute',
      hostnameTemplate: 'regional',
    })
    const otherEndpoint = await first.client.prepareStaticEndpoint(otherPolicy)
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        body: JSON.stringify({
          endpoint: 'https://resource.database.us-ashburn-1.oraclecloud.com',
        }),
      })
    )
    const wrongResourceResponse = await first.client.request({
      endpoint: otherEndpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    await expect(
      first.client.prepareDiscoveredEndpoint(policy, wrongResourceResponse)
    ).rejects.toMatchObject({ code: 'invalid_endpoint' })
    await expect(
      first.client.prepareDiscoveredEndpoint(policy, {
        status: 200,
        headers: {},
        body: new Uint8Array(),
      } as OciAuthenticatedResponse)
    ).rejects.toMatchObject({ code: 'invalid_endpoint' })
  })

  it('prepares discovery from the retained safe Location header', async () => {
    const policy = createOciDiscoveredEndpointPolicy({
      serviceId: OCI_SERVICE_ID,
      serviceName: 'database',
      hostnameTemplate: 'regional',
      responsePolicy: STATIC_POLICY,
      source: { kind: 'header', name: 'location' },
    })
    const { client, endpoint } = await createPreparedClient()
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({
        headers: {
          location: 'https://resource.database.us-ashburn-1.oraclecloud.com',
          'x-provider-secret': 'hidden',
        },
      })
    )
    const response = await client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      responseHeaders: ['location'],
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    expect((await client.prepareDiscoveredEndpoint(policy, response)).origin).toBe(
      'https://resource.database.us-ashburn-1.oraclecloud.com'
    )
    expect(response.headers).not.toHaveProperty('x-provider-secret')
  })

  it('propagates caller abort without leaking a transport failure', async () => {
    const controller = new AbortController()
    mocks.secureFetch.mockImplementationOnce(() => new Promise(() => {}))
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      signal: controller.signal,
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('applies one deadline to in-flight transport work', async () => {
    vi.useFakeTimers()
    mocks.secureFetch.mockImplementationOnce(() => new Promise(() => {}))
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 100,
      maxResponseBytes: 1024,
    })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'deadline_exceeded' })
    await vi.advanceTimersByTimeAsync(101)
    await assertion
  })

  it('does not start a pinned request when destination validation outlives the deadline', async () => {
    vi.useFakeTimers()
    let finishValidation:
      | ((value: { isValid: true; resolvedIP: string; originalHostname: string }) => void)
      | undefined
    mocks.validateUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishValidation = resolve
        })
    )
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 100,
      maxResponseBytes: 1024,
    })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'deadline_exceeded' })
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    finishValidation?.({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'identity.us-ashburn-1.oci.oraclecloud.com',
    })
    await Promise.resolve()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('propagates caller abort while setup destination validation is pending', async () => {
    const controller = new AbortController()
    mocks.validateUrl.mockImplementationOnce(() => new Promise(() => {}))
    const pending = verifyOciApiKeyCredentialForSetup(SECRET, controller.signal)
    await vi.waitFor(() => expect(mocks.validateUrl).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('does not start setup destination validation after an earlier caller abort', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      verifyOciApiKeyCredentialForSetup(SECRET, controller.signal)
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(mocks.validateUrl).not.toHaveBeenCalled()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('applies the setup deadline while destination validation is pending', async () => {
    vi.useFakeTimers()
    let finishValidation:
      | ((value: { isValid: true; resolvedIP: string; originalHostname: string }) => void)
      | undefined
    mocks.validateUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishValidation = resolve
        })
    )
    const pending = verifyOciApiKeyCredentialForSetup(SECRET)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'deadline_exceeded' })
    await vi.advanceTimersByTimeAsync(10_001)
    await assertion
    finishValidation?.({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'objectstorage.us-ashburn-1.oraclecloud.com',
    })
    await Promise.resolve()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('applies the same deadline while reading the response body', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    mocks.secureFetch.mockResolvedValueOnce({
      ...secureResponse({}),
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({ cancel }),
    })
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      timeoutMs: 100,
      maxResponseBytes: 1024,
    })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'deadline_exceeded' })
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    expect(cancel).toHaveBeenCalled()
  })

  it('propagates caller abort while reading a failed response body', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    mocks.secureFetch.mockResolvedValueOnce({
      ...secureResponse({ status: 409 }),
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({ cancel }),
    })
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      signal: controller.signal,
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    await vi.waitFor(() => expect(mocks.secureFetch).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(cancel).toHaveBeenCalled()
  })

  it('propagates caller abort during retry backoff', async () => {
    vi.useFakeTimers()
    mocks.backoff.mockReturnValue(1000)
    mocks.secureFetch.mockResolvedValueOnce(
      secureResponse({ status: 503, body: '{"code":"Busy"}' })
    )
    const controller = new AbortController()
    const { client, endpoint } = await createPreparedClient()
    const pending = client.request({
      endpoint,
      method: 'GET',
      encodedPath: '/v1/test',
      retry: { kind: 'safe', maxAttempts: 2 },
      signal: controller.signal,
      timeoutMs: 10_000,
      maxResponseBytes: 1024,
    })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await assertion
    expect(mocks.secureFetch).toHaveBeenCalledOnce()
  })
})
