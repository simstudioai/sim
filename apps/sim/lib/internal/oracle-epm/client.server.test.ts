/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsyncValidationResult } from '@/lib/core/security/input-validation.server'
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
import type {
  OracleEpmEndpointDeclaration,
  OracleEpmValidatedLink,
} from '@/lib/internal/oracle-epm/types'

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

  it.each([null, 123, true, {}, ['etag'], new Uint8Array([65])])(
    'rejects non-string header %j before DNS or fetch',
    async (etag) => {
      const client = createOracleEpmClient({
        instanceUrl: 'https://epm.example.com',
        accessToken: Buffer.from('u:p').toString('base64'),
      })
      await expect(
        client.request(getJob, {
          pathParams: { jobId: '42' },
          headers: { etag: etag as unknown as string },
        })
      ).rejects.toMatchObject({ name: 'OracleEpmError', category: 'invalid_input' })
      expect(mockValidateUrl).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects header objects without invoking their string coercion', async () => {
    const stringifyHeader = vi.fn(() => 'coerced-header')
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com',
      accessToken: Buffer.from('u:p').toString('base64'),
    })
    await expect(
      client.request(getJob, {
        pathParams: { jobId: '42' },
        headers: { etag: { toString: stringifyHeader } as unknown as string },
      })
    ).rejects.toMatchObject({ category: 'invalid_input' })
    expect(stringifyHeader).not.toHaveBeenCalled()
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
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
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  describe('DNS cancellation', () => {
    afterEach(() => vi.restoreAllMocks())

    it.each(['deadline', 'caller'] as const)(
      'ends on %s cancellation even when DNS never settles',
      async (source) => {
        const deadline = new AbortController()
        const caller = new AbortController()
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
        mockValidateUrl.mockReturnValueOnce(new Promise<AsyncValidationResult>(() => {}))
        const client = createOracleEpmClient({
          instanceUrl: 'https://epm.example.com',
          accessToken: Buffer.from('u:p').toString('base64'),
        })
        const rejected = vi.fn()
        const fulfilled = vi.fn()
        const request = client
          .request(getJob, { pathParams: { jobId: '42' }, signal: caller.signal })
          .then(fulfilled, rejected)
        const callerReason = new DOMException('caller cancelled', 'AbortError')
        if (source === 'deadline') deadline.abort(new DOMException('deadline', 'TimeoutError'))
        else caller.abort(callerReason)

        await vi.waitFor(() => expect(rejected).toHaveBeenCalledTimes(1), {
          interval: 1,
          timeout: 100,
        })
        await request
        expect(timeout).toHaveBeenCalledWith(5_000)
        expect(rejected).toHaveBeenCalledWith(
          source === 'deadline'
            ? expect.objectContaining({ category: 'timeout', retryable: true })
            : callerReason
        )
        expect(fulfilled).not.toHaveBeenCalled()
        expect(mockSecureFetch).not.toHaveBeenCalled()
      }
    )

    it.each(['resolve', 'reject'] as const)(
      'does not revive a cancelled request when DNS later %ss',
      async (settlement) => {
        const dns = Promise.withResolvers<AsyncValidationResult>()
        mockValidateUrl.mockReturnValueOnce(dns.promise)
        const controller = new AbortController()
        const client = createOracleEpmClient({
          instanceUrl: 'https://epm.example.com',
          accessToken: Buffer.from('u:p').toString('base64'),
        })
        const rejected = vi.fn()
        const request = client
          .request(getJob, { pathParams: { jobId: '42' }, signal: controller.signal })
          .catch(rejected)
        controller.abort(new DOMException('caller cancelled', 'AbortError'))
        await vi.waitFor(() => expect(rejected).toHaveBeenCalledTimes(1), {
          interval: 1,
          timeout: 100,
        })
        await request

        if (settlement === 'resolve') {
          dns.resolve({
            isValid: true,
            resolvedIP: '203.0.113.10',
            originalHostname: 'epm.example.com',
          })
        } else {
          dns.reject(new Error('late resolver failure'))
        }
        await Promise.resolve()
        expect(rejected).toHaveBeenCalledTimes(1)
        expect(mockSecureFetch).not.toHaveBeenCalled()
      }
    )

    it('suppresses unexpected DNS rejection details', async () => {
      mockValidateUrl.mockRejectedValueOnce(new Error('private resolver failure'))
      const client = createOracleEpmClient({
        instanceUrl: 'https://epm.example.com',
        accessToken: Buffer.from('u:p').toString('base64'),
      })
      const error = await client
        .request(getJob, { pathParams: { jobId: '42' } })
        .catch((value: unknown) => value)
      expect(error).toMatchObject({ category: 'service_unavailable', retryable: true })
      expect(String(error)).not.toContain('private resolver failure')
      expect(mockSecureFetch).not.toHaveBeenCalled()
    })
  })

  it.each([null, undefined, 'invalid-link', 123, true, [], {}, { rel: 'download' }])(
    'rejects malformed returned-link entry %j with a safe error',
    (entry) => {
      const policy = routes.defineReturnedLinkPolicy({
        relation: 'download',
        method: 'GET',
        endpoint: getJob,
        preserveGatewayBasePath: true,
      })
      const client = createOracleEpmClient({
        instanceUrl: 'https://epm.example.com/gateway',
        accessToken: Buffer.from('u:p').toString('base64'),
      })

      expect(() =>
        client.validateReturnedLink(
          policy,
          entry as unknown as Parameters<typeof client.validateReturnedLink>[1]
        )
      ).toThrowError(expect.objectContaining({ name: 'OracleEpmError', category: 'invalid_input' }))
      expect(mockValidateUrl).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it.each(['download', 'Job Status'])(
    'keeps %s links opaque and client-owned',
    async (relation) => {
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
        relation,
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
        rel: relation,
        href: `https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=${secret}`,
      })

      expect(Object.isFrozen(link)).toBe(true)
      expect(Object.keys(link)).toEqual([])
      expect(JSON.stringify(link)).toBe('{}')
      expect(String(link)).not.toContain(secret)

      mockSecureFetch.mockResolvedValue(secureResponse({ body: new ReadableStream() }))
      await client.requestValidatedLink(link)
      expect(mockSecureFetch).toHaveBeenCalledWith(
        `https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc?token=${secret}`,
        '203.0.113.10',
        expect.objectContaining({ method: 'GET' })
      )

      const otherClient = createOracleEpmClient({
        instanceUrl: 'https://epm.example.com/gateway',
        accessToken: Buffer.from('other:password').toString('base64'),
      })
      await expect(otherClient.requestValidatedLink(link)).rejects.toBeInstanceOf(OracleEpmError)
      expect(mockValidateUrl).toHaveBeenCalledTimes(1)
      expect(mockSecureFetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each(
    [
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
    ].flatMap((href) => ['download', 'Job Status'].map((relation) => ({ relation, href })))
  )('rejects unsafe $relation link $href', ({ relation, href }) => {
    const policy = routes.defineReturnedLinkPolicy({
      relation,
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
    expect(() => client.validateReturnedLink(policy, { rel: relation, href })).toThrow()
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each(['download', 'Job Status'])('rejects an incorrect %s link method', (relation) => {
    const policy = routes.defineReturnedLinkPolicy({
      relation,
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
        rel: relation,
        method: 'POST',
        href: 'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/files/abc',
      })
    ).toThrow()
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each([
    'job status',
    'Job status',
    ' Job Status',
    'Job Status ',
    'Job  Status',
    'Job\tStatus',
    'Job Status\n',
    'download',
  ])('rejects nonmatching relation %j before DNS or network access', (rel) => {
    const policy = routes.defineReturnedLinkPolicy({
      relation: 'Job Status',
      method: 'GET',
      endpoint: getJob,
      preserveGatewayBasePath: true,
    })
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway',
      accessToken: Buffer.from('u:p').toString('base64'),
    })

    expect(() =>
      client.validateReturnedLink(policy, {
        rel,
        method: 'GET',
        href: 'https://epm.example.com/gateway/SyntheticAlpha/rest/v3/jobs/42',
      })
    ).toThrow(OracleEpmError)
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
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

  describe('repository path parameters', () => {
    const declaration = {
      method: 'GET',
      version: 'v3',
      path: [
        oracleEpmLiteral('files'),
        oracleEpmPathParameter('fileName', { maxBytes: 255, mode: 'repository-path' }),
        oracleEpmLiteral('contents'),
      ],
      query: { token: oracleEpmQuery.string({ maxBytes: 128 }) },
      body: 'none',
      response: 'stream',
      timeoutMs: 5_000,
      maxResponseBytes: 4_096,
    } satisfies OracleEpmEndpointDeclaration
    const download = routes.defineEndpoint(declaration)
    const prefix = 'https://epm.example.com/gateway/acme/SyntheticAlpha/rest/v3'
    const client = createOracleEpmClient({
      instanceUrl: 'https://epm.example.com/gateway/acme',
      accessToken: Buffer.from('u:p').toString('base64'),
    })

    it.each([
      ['outbox/reports/results.csv', 'outbox%2Freports%2Fresults.csv'],
      ['inbox\\Monthly Report.csv', 'inbox%5CMonthly%20Report.csv'],
      ['outbox\\reports/results.csv', 'outbox%5Creports%2Fresults.csv'],
      ['outbox/résumé-😀.csv', 'outbox%2Fr%C3%A9sum%C3%A9-%F0%9F%98%80.csv'],
      [' report.csv ', '%20report.csv%20'],
      ['outbox/100%.csv', 'outbox%2F100%25.csv'],
      ['outbox%2Freport.csv', 'outbox%252Freport.csv'],
      ['outbox/%2e%2e/report.csv', 'outbox%2F%252e%252e%2Freport.csv'],
    ])('encodes raw filename %j once without rewriting it', async (fileName, encoded) => {
      await client.request(download, { pathParams: { fileName } })
      expect(mockSecureFetch.mock.calls[0][0]).toBe(`${prefix}/files/${encoded}/contents`)
      expect(mockValidateUrl).toHaveBeenCalledWith(
        'https://epm.example.com',
        'Oracle EPM destination',
        'configuredEndpoint',
        { logDetails: false }
      )
    })

    it.each([
      '',
      '/file.csv',
      '\\file.csv',
      '\\\\server\\file.csv',
      'C:\\file.csv',
      'c:file.csv',
      'outbox//file.csv',
      'outbox\\\\file.csv',
      'outbox/\\file.csv',
      'outbox/',
      'outbox\\',
      '.',
      '..',
      './file.csv',
      '../file.csv',
      'outbox/./file.csv',
      'outbox/../file.csv',
      'outbox\\..\\file.csv',
      'outbox/..',
      'outbox/\nfile.csv',
      'outbox/\u0000file.csv',
      'outbox/\u007ffile.csv',
      'outbox/\uD800.csv',
      'a'.repeat(256),
      'é'.repeat(128),
    ])('rejects invalid raw filename %j before DNS or fetch', async (fileName) => {
      await expect(client.request(download, { pathParams: { fileName } })).rejects.toMatchObject({
        category: 'invalid_input',
      })
      expect(mockValidateUrl).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    })

    it('accepts the full 255-byte raw UTF-8 boundary', async () => {
      const fileName = `${'é'.repeat(127)}x`
      await client.request(download, { pathParams: { fileName } })
      expect(mockSecureFetch.mock.calls[0][0]).toBe(
        `${prefix}/files/${encodeURIComponent(fileName)}/contents`
      )
    })

    it.each([undefined, 'segment'] as const)(
      'keeps mode %j strict for ordinary IDs',
      async (mode) => {
        const endpoint = routes.defineEndpoint({
          ...declaration,
          path: [oracleEpmLiteral('jobs'), oracleEpmPathParameter('jobId', { maxBytes: 64, mode })],
        })
        for (const jobId of ['folder/id', 'folder\\id']) {
          await expect(client.request(endpoint, { pathParams: { jobId } })).rejects.toMatchObject({
            category: 'invalid_input',
          })
        }
        expect(mockValidateUrl).not.toHaveBeenCalled()
        expect(mockSecureFetch).not.toHaveBeenCalled()
        await client.request(endpoint, { pathParams: { jobId: 'job 42' } })
        expect(mockSecureFetch.mock.calls[0][0]).toBe(`${prefix}/jobs/job%2042`)
      }
    )

    it('does not let request input select the parameter mode', async () => {
      await expect(
        client.request(getJob, { pathParams: { jobId: 'folder/id', mode: 'repository-path' } })
      ).rejects.toMatchObject({ category: 'invalid_input' })
      expect(mockValidateUrl).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    })

    describe.each(['endpoint', 'route'] as const)('%s-bound returned links', (binding) => {
      function definePolicy(endpointDeclaration = declaration, preserveGatewayBasePath = true) {
        return routes.defineReturnedLinkPolicy({
          relation: 'download',
          method: 'GET',
          ...(binding === 'endpoint'
            ? { endpoint: routes.defineEndpoint(endpointDeclaration) }
            : {
                version: endpointDeclaration.version,
                path: endpointDeclaration.path,
                query: endpointDeclaration.query,
                response: endpointDeclaration.response,
                timeoutMs: endpointDeclaration.timeoutMs,
                maxResponseBytes: endpointDeclaration.maxResponseBytes,
              }),
          preserveGatewayBasePath,
        })
      }
      const policy = definePolicy()

      it.each([
        'outbox%2Freports%2Fresults.csv',
        'inbox%5CMonthly%20Report.csv',
        'outbox%2fr%C3%A9sum%C3%A9-%F0%9F%98%80.csv',
        'outbox%2F100%25.csv',
        'outbox%2F%2525252561.csv',
        `${'%C3%A9'.repeat(127)}x`,
      ])('retains filename encoding and query bytes for %s', async (encoded) => {
        const href = `${prefix}/files/${encoded}/contents?token=secret%2bvalue`
        const link = client.validateReturnedLink(policy, { rel: 'download', href })
        expect(Object.isFrozen(link)).toBe(true)
        expect(Object.keys(link)).toEqual([])
        expect(JSON.stringify(link)).toBe('{}')
        await client.requestValidatedLink(link)
        expect(mockSecureFetch.mock.calls[0][0]).toBe(href)

        const otherClient = createOracleEpmClient({
          instanceUrl: 'https://epm.example.com/gateway/acme',
          accessToken: Buffer.from('other:p').toString('base64'),
        })
        await expect(otherClient.requestValidatedLink(link)).rejects.toMatchObject({
          category: 'invalid_input',
        })
        expect(mockSecureFetch).toHaveBeenCalledTimes(1)
      })

      it.each([
        'outbox/report.csv',
        'outbox\\report.csv',
        '%2Freport.csv',
        '%5C%5Cserver%5Creport.csv',
        'C%3A%5Creport.csv',
        'c%3Areport.csv',
        'outbox%2F%2Freport.csv',
        'outbox%2F',
        'outbox%2F.%2Freport.csv',
        'outbox%2F..%2Fsecret.csv',
        'outbox%5C..%5Csecret.csv',
        'outbox%2F%252e%252e%2Fsecret.csv',
        'outbox%252F%252e%252e%252Fsecret.csv',
        'outbox%2F%00report.csv',
        'outbox%2F%250areport.csv',
        'outbox%2F%7freport.csv',
        'outbox%2F%ED%A0%80.csv',
        'outbox%2Fbad%.csv',
        'outbox%2F%25FF.csv',
        '%C3%A9'.repeat(128),
        '%252525252561.csv',
      ])('rejects invalid encoded filenames %s', (encoded) => {
        expect(() =>
          client.validateReturnedLink(policy, {
            rel: 'download',
            href: `${prefix}/files/${encoded}/contents`,
          })
        ).toThrow(OracleEpmError)
        expect(mockValidateUrl).not.toHaveBeenCalled()
        expect(mockSecureFetch).not.toHaveBeenCalled()
      })

      it('validates bounds and patterns against the once-decoded filename', async () => {
        const boundedDeclaration = {
          ...declaration,
          path: [
            oracleEpmPathParameter('fileName', {
              maxBytes: 14,
              pattern: /^outbox\/%61\.csv$/,
              mode: 'repository-path',
            }),
          ],
        }
        const endpoint = routes.defineEndpoint(boundedDeclaration)
        const boundedPolicy = definePolicy(boundedDeclaration)
        const fileName = 'outbox/%61.csv'
        const href = `${prefix}/outbox%2F%2561.csv`
        await client.request(endpoint, { pathParams: { fileName } })
        const handle = client.validateReturnedLink(boundedPolicy, { rel: 'download', href })
        await client.requestValidatedLink(handle)
        expect(mockSecureFetch.mock.calls.map(([url]) => url)).toEqual([href, href])
        for (const invalid of ['outbox/a.csv', 'inbox/%61.csv', 'outbox/long%61.csv']) {
          await expect(
            client.request(endpoint, { pathParams: { fileName: invalid } })
          ).rejects.toMatchObject({ category: 'invalid_input' })
          expect(() =>
            client.validateReturnedLink(boundedPolicy, {
              rel: 'download',
              href: `${prefix}/${encodeURIComponent(invalid)}`,
            })
          ).toThrow(OracleEpmError)
        }
        expect(mockSecureFetch).toHaveBeenCalledTimes(2)
      })

      it('preserves the declared gateway-prefix policy', async () => {
        const originHref =
          'https://epm.example.com/SyntheticAlpha/rest/v3/files/outbox%2Freport.csv/contents'
        expect(() =>
          client.validateReturnedLink(policy, { rel: 'download', href: originHref })
        ).toThrow(OracleEpmError)
        const originPolicy = definePolicy(declaration, false)
        const handle = client.validateReturnedLink(originPolicy, {
          rel: 'download',
          href: originHref,
        })
        await client.requestValidatedLink(handle)
        expect(mockSecureFetch.mock.calls[0][0]).toBe(originHref)
        expect(() =>
          client.validateReturnedLink(originPolicy, {
            rel: 'download',
            href: `${prefix}/files/outbox%2Freport.csv/contents`,
          })
        ).toThrow(OracleEpmError)
      })

      it.each([
        [
          'origin',
          `${prefix.replace('epm.example.com', 'other.example.com')}/files/outbox%2Freport.csv/contents`,
        ],
        [
          'userinfo',
          `${prefix.replace('https://', 'https://user@')}/files/outbox%2Freport.csv/contents`,
        ],
        [
          'gateway',
          `${prefix.replace('/gateway/acme/', '/gateway%2Facme/')}/files/outbox%2Freport.csv/contents`,
        ],
        [
          'context',
          `${prefix.replace('/SyntheticAlpha/rest/', '/SyntheticAlpha%2Frest/')}/files/outbox%2Freport.csv/contents`,
        ],
        ['literal', `${prefix}/files%2Fextra/outbox%2Freport.csv/contents`],
        ['suffix', `${prefix}/files/outbox%2Freport.csv/contents%2Fextra`],
        ['extra segment', `${prefix}/files/outbox%2Freport.csv/extra/contents`],
        ['duplicate query', `${prefix}/files/outbox%2Freport.csv/contents?token=a&token=b`],
        ['unknown query', `${prefix}/files/outbox%2Freport.csv/contents?unknown=x`],
        ['fragment', `${prefix}/files/outbox%2Freport.csv/contents#fragment`],
      ])('preserves the %s restriction', (_label, href) => {
        expect(() => client.validateReturnedLink(policy, { rel: 'download', href })).toThrow(
          OracleEpmError
        )
        expect(mockSecureFetch).not.toHaveBeenCalled()
      })

      it('keeps ordinary parameters, methods, and relations strict on repository endpoints', () => {
        const mixedPolicy = definePolicy({
          ...declaration,
          path: [...declaration.path, oracleEpmPathParameter('jobId', { maxBytes: 64 })],
        })
        const href = `${prefix}/files/outbox%2Freport.csv/contents`
        for (const jobId of ['a%2Fb', 'a%5Cb']) {
          expect(() =>
            client.validateReturnedLink(mixedPolicy, { rel: 'download', href: `${href}/${jobId}` })
          ).toThrow(OracleEpmError)
        }
        expect(() =>
          client.validateReturnedLink(policy, { rel: 'download', method: 'POST', href })
        ).toThrow(OracleEpmError)
        expect(() => client.validateReturnedLink(policy, { rel: 'other', href })).toThrow(
          OracleEpmError
        )
        expect(mockSecureFetch).not.toHaveBeenCalled()
      })
    })
  })
})
