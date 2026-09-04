/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  oracleEpmLiteral,
  oracleEpmPathParameter,
  oracleEpmQuery,
} from '@/lib/internal/oracle-epm/endpoint'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type { OracleEpmValidatedLink } from '@/lib/internal/oracle-epm/types'

const routes = defineOracleEpmRouteSpace({
  context: ['SyntheticAlpha', 'rest'],
  allowedVersions: ['v3'],
})
const getJob = routes.defineEndpoint({
  method: 'GET',
  version: 'v3',
  path: [oracleEpmLiteral('jobs'), oracleEpmPathParameter('jobId', { maxBytes: 64 })],
  query: { limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }) },
  headers: { etag: { name: 'If-None-Match', maxBytes: 128 } },
  body: 'none',
  response: 'json',
  timeoutMs: 5_000,
  maxResponseBytes: 4_096,
  errors: {
    providerCodePath: ['code'],
    allowedProviderCodes: ['KNOWN'],
    correlationHeaders: ['x-request-id'],
  },
})

function secureResponse(input: {
  ok?: boolean
  status?: number
  data?: unknown
  body?: ReadableStream<Uint8Array> | null
}) {
  const data = input.data ?? { ok: true }
  const defaultBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(data)))
      controller.close()
    },
  })
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    statusText: '',
    headers: { get: (name: string) => (name === 'x-request-id' ? 'request-1' : null) },
    body: input.body === undefined ? defaultBody : input.body,
    text: async () => JSON.stringify(data),
    json: async () => data,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('Oracle EPM guarded client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mockSecureFetch.mockResolvedValue(secureResponse({}))
  })

  it('binds an encoded request to the credential origin and gateway path', async () => {
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway/acme',
      accessToken: Buffer.from('user:password').toString('base64'),
    })
    await client.request(getJob, {
      pathParams: { jobId: 'job with spaces' },
      query: { limit: 25 },
      headers: { etag: 'safe-etag' },
    })

    expect(mockValidateUrl).toHaveBeenCalledWith(
      'https://epm.example.com',
      'Oracle EPM destination',
      'configuredEndpoint',
      { logDetails: false }
    )
    expect(mockSecureFetch).toHaveBeenCalledWith(
      'https://epm.example.com/gateway/acme/SyntheticAlpha/rest/v3/jobs/job%20with%20spaces?limit=25',
      '203.0.113.10',
      expect.objectContaining({
        method: 'GET',
        maxRedirects: 0,
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
          'If-None-Match': 'safe-etag',
        }),
      })
    )
  })

  it.each([
    { pathParams: { jobId: '../admin' } },
    { pathParams: { jobId: 'ok' }, query: { unknown: 'value' } },
    { pathParams: { jobId: 'ok' }, query: { limit: 101 } },
    { pathParams: { jobId: 'ok' }, headers: { Authorization: 'forged' } },
  ])('rejects undeclared or out-of-bounds request input', async (input) => {
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/base',
      accessToken: Buffer.from('user:password').toString('base64'),
    })
    await expect(client.request(getJob, input)).rejects.toBeInstanceOf(OracleEpmError)
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('encodes already-encoded traversal text as one inert path segment', async () => {
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await client.request(getJob, { pathParams: { jobId: '%2e%2e%2fadmin' } })
    expect(mockValidateUrl).toHaveBeenCalledWith(
      'https://epm.example.com',
      expect.any(String),
      'configuredEndpoint',
      expect.any(Object)
    )
    expect(mockSecureFetch.mock.calls[0][0]).toContain('%252e%252e%252fadmin')
  })

  it('rejects malformed UTF-16 path input before URL encoding', async () => {
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await expect(client.request(getJob, { pathParams: { jobId: '\uD800' } })).rejects.toMatchObject(
      { category: 'invalid_input' }
    )
    expect(mockValidateUrl).not.toHaveBeenCalled()
  })

  it('preserves valid surrogate pairs in encoded path and query parameters', async () => {
    const endpoint = routes.defineEndpoint({
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('files'), oracleEpmPathParameter('fileId', { maxBytes: 32 })],
      query: { label: oracleEpmQuery.string({ maxBytes: 32 }) },
      body: 'none',
      response: 'json',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await client.request(endpoint, {
      pathParams: { fileId: 'report-😀' },
      query: { label: 'locked-🔒' },
    })
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/SyntheticAlpha/rest/v3/files/report-%F0%9F%98%80?label=locked-%F0%9F%94%92'
    )
  })

  it('preserves streamed response size failures as payload-too-large errors', async () => {
    mockSecureFetch.mockResolvedValue({
      ...secureResponse({}),
      json: vi.fn().mockRejectedValue(
        new PayloadSizeLimitError({
          label: 'secure fetch response',
          maxBytes: 4_096,
          observedBytes: 4_097,
        })
      ),
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await expect(client.request(getJob, { pathParams: { jobId: '42' } })).rejects.toMatchObject({
      category: 'payload_too_large',
    })
  })

  it('suppresses arbitrary provider bodies in failed requests', async () => {
    mockSecureFetch.mockResolvedValue(
      secureResponse({
        ok: false,
        status: 400,
        data: { code: 'UNKNOWN', message: 'secret-provider-message' },
      })
    )
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('user:password').toString('base64'),
    })
    const error = await client
      .request(getJob, { pathParams: { jobId: '42' } })
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(OracleEpmError)
    expect(JSON.stringify(error)).not.toContain('secret-provider-message')
    expect(error).toMatchObject({ providerCode: undefined, correlationId: 'request-1' })
  })

  it('retries only a statically declared safe operation and preserves request bounds', async () => {
    const endpoint = routes.defineEndpoint({
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('health')],
      body: 'none',
      response: 'json',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
      retry: { maxAttempts: 2, statuses: [503], initialDelayMs: 1, maxDelayMs: 1 },
    })
    mockSecureFetch
      .mockResolvedValueOnce(secureResponse({ ok: false, status: 503 }))
      .mockResolvedValueOnce(secureResponse({ data: { ready: true } }))
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await expect(client.request(endpoint)).resolves.toMatchObject({ data: { ready: true } })
    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects oversized declared request bodies before DNS or network access', async () => {
    const endpoint = routes.defineEndpoint({
      method: 'POST',
      version: 'v3',
      path: [oracleEpmLiteral('jobs')],
      body: 'json',
      maxRequestBytes: 8,
      response: 'json',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    const error = await client
      .request(endpoint, { json: { tooLarge: true } })
      .catch((value: unknown) => value)
    expect(error).toMatchObject({ category: 'payload_too_large' })
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('rejects accessors and inherited JSON serializers without invoking them', async () => {
    const endpoint = routes.defineEndpoint({
      method: 'POST',
      version: 'v3',
      path: [oracleEpmLiteral('jobs')],
      body: 'json',
      maxRequestBytes: 1_024,
      response: 'json',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    })
    const inheritedSerializer = vi.fn(() => ({ changed: true }))
    const inherited = Object.create({ toJSON: inheritedSerializer }) as Record<string, unknown>
    inherited.value = 'safe'
    const getter = vi.fn(() => 'secret')
    const accessor = {}
    Object.defineProperty(accessor, 'value', { enumerable: true, get: getter })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })

    await expect(client.request(endpoint, { json: inherited })).rejects.toMatchObject({
      category: 'invalid_input',
    })
    await expect(client.request(endpoint, { json: accessor })).rejects.toMatchObject({
      category: 'invalid_input',
    })
    expect(inheritedSerializer).not.toHaveBeenCalled()
    expect(getter).not.toHaveBeenCalled()
    expect(mockValidateUrl).not.toHaveBeenCalled()
  })

  it('propagates caller aborts before opening a pinned request', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('user', 'AbortError'))
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await expect(
      client.request(getJob, {
        pathParams: { jobId: '42' },
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('returns an opaque same-client link capability and keeps query secrets out of serialization', async () => {
    const download = routes.defineEndpoint({
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('files'), oracleEpmPathParameter('fileId', { maxBytes: 32 })],
      query: { token: oracleEpmQuery.string({ required: true, maxBytes: 128 }) },
      body: 'none',
      response: 'stream',
      timeoutMs: 5_000,
      maxResponseBytes: 4_096,
    })
    const policy = routes.defineReturnedLinkPolicy({
      relation: 'download',
      method: 'GET',
      endpoint: download,
      preserveGatewayBasePath: true,
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway',
      accessToken: Buffer.from('user:password').toString('base64'),
    })
    const secret = 'signed-query-secret'
    const link = client.validateReturnedLink(policy, {
      rel: 'download',
      href: `https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=${secret}`,
    })

    expect(Object.isFrozen(link)).toBe(true)
    expect(Object.keys(link)).toEqual([])
    expect(JSON.stringify(link)).toBe('{}')
    expect(String(link)).not.toContain(secret)

    mockSecureFetch.mockResolvedValue(secureResponse({ body: new ReadableStream() }))
    await client.requestValidatedLink(link)
    expect(mockSecureFetch).toHaveBeenCalledTimes(1)

    const otherClient = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway',
      accessToken: Buffer.from('other:password').toString('base64'),
    })
    await expect(otherClient.requestValidatedLink(link)).rejects.toBeInstanceOf(OracleEpmError)
  })

  it.each([
    'https://evil.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=x',
    'https://user@epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=x',
    'https://epm.example.com/SyntheticAlpha/rest/v3/files/abc?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=x&token=y',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?unknown=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=x#fragment',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=x#',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/ab\nc?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/\uD800?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest//v3/files/abc?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc/?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/./abc?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/%2e%2e?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/%2e.?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/%252e%252e?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files%2Fabc?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files%5Cabc?token=x',
    'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files\\abc?token=x',
  ])('rejects unsafe returned link %j', (href) => {
    const policy = routes.defineReturnedLinkPolicy({
      relation: 'download',
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('files'), oracleEpmPathParameter('fileId', { maxBytes: 32 })],
      query: { token: oracleEpmQuery.string({ required: true, maxBytes: 128 }) },
      response: 'stream',
      timeoutMs: 5_000,
      maxResponseBytes: 4_096,
      preserveGatewayBasePath: true,
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    expect(() => client.validateReturnedLink(policy, { rel: 'download', href })).toThrow()
  })

  it('rejects an incorrect returned-link method', () => {
    const policy = routes.defineReturnedLinkPolicy({
      relation: 'download',
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('files'), oracleEpmPathParameter('fileId', { maxBytes: 32 })],
      response: 'stream',
      timeoutMs: 5_000,
      maxResponseBytes: 4_096,
      preserveGatewayBasePath: true,
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    expect(() =>
      client.validateReturnedLink(policy, {
        rel: 'download',
        method: 'POST',
        href: 'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc',
      })
    ).toThrow()
  })

  it('rejects forged validated-link handles', async () => {
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await expect(client.requestValidatedLink({} as OracleEpmValidatedLink)).rejects.toBeInstanceOf(
      OracleEpmError
    )
  })
})
