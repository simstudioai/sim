/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockSleep, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockSleep: vi.fn(),
  mockValidateUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))
vi.mock('@sim/utils/helpers', () => ({ interruptibleSleep: mockSleep }))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  type OracleFusionResolvedCredential,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const BASIC = Buffer.from('integration-user:password').toString('base64')
const CREDENTIAL: OracleFusionResolvedCredential = {
  instanceUrl: ORIGIN,
  accessToken: BASIC,
}

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: vi.fn(async () => body),
    json: vi.fn(async () => JSON.parse(body)),
    arrayBuffer: vi.fn(async () => new TextEncoder().encode(body).buffer),
  }
}

describe('requestOracleFusionJson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrl.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
    mockSleep.mockResolvedValue(undefined)
    mockSecureFetch.mockResolvedValue(response(200, '{"items":[]}'))
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['hcm', '/hcmRestApi/resources/11.13.18.05/workers'],
    ['fscm', '/fscmRestApi/resources/11.13.18.05/invoices'],
  ] as const)(
    'pins the %s API family, headers, DNS result, and GET method',
    async (family, path) => {
      await expect(
        requestOracleFusionJson(CREDENTIAL, {
          family,
          path: path.split('/').at(-1)!,
          query: { q: 'Name="A B"', limit: 25, expand: undefined, onlyData: true },
        })
      ).resolves.toEqual({ items: [] })

      expect(mockValidateUrl).toHaveBeenCalledWith(
        ORIGIN,
        'Fusion Applications URL',
        'configuredEndpoint',
        { logDetails: false }
      )
      const [url, resolvedIP, init] = mockSecureFetch.mock.calls[0]
      const parsedUrl = new URL(url)
      expect(parsedUrl.origin + parsedUrl.pathname).toBe(`${ORIGIN}${path}`)
      expect(parsedUrl.searchParams.get('q')).toBe('Name="A B"')
      expect(parsedUrl.searchParams.get('limit')).toBe('25')
      expect(parsedUrl.searchParams.get('onlyData')).toBe('true')
      expect(parsedUrl.searchParams.has('expand')).toBe(false)
      expect(resolvedIP).toBe('203.0.113.10')
      expect(init).toMatchObject({
        profile: 'configuredEndpoint',
        method: 'GET',
        timeout: 30_000,
        maxRedirects: 0,
        maxResponseBytes: 5 * 1024 * 1024,
        logUrlValidationDetails: false,
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${BASIC}`,
          'REST-Framework-Version': '9',
        },
      })
    }
  )

  it.each([
    '',
    '/workers',
    '//evil.example/workers',
    'https://evil.example/workers',
    'workers/../users',
    'workers/./users',
    'workers\\users',
    'workers?limit=1',
    'workers#fragment',
    'workers/%2e%2e/users',
    'workers/%2Fusers',
    'workers/%5cusers',
  ])('rejects the unsafe relative path %j before DNS or fetch', async (path) => {
    await expect(requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path })).rejects.toThrow(
      /safe relative path|traversal/
    )
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('accepts the URL-safe encoding produced for an opaque key containing a percent sign', async () => {
    await expect(
      requestOracleFusionJson(CREDENTIAL, {
        family: 'hcm',
        path: 'workers/key%252Fpart',
      })
    ).resolves.toEqual({ items: [] })
    expect(new URL(mockSecureFetch.mock.calls[0][0]).pathname).toMatch(/\/workers\/key%252Fpart$/)
  })

  it('rejects a non-public DNS result before fetching', async () => {
    mockValidateUrl.mockResolvedValueOnce({ isValid: false, error: 'private address' })
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' })
    ).rejects.toThrow('not a public endpoint')
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('retries 429, 503, and 504 at most twice and honors bounded Retry-After', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(response(429, 'secret provider body', { 'retry-after': '90' }))
      .mockResolvedValueOnce(response(503, 'secret provider body', { 'retry-after': '1' }))
      .mockResolvedValueOnce(response(504, 'secret provider body'))

    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'fscm', path: 'invoices' })
    ).rejects.toMatchObject({ status: 504 })
    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
    expect(mockSleep).toHaveBeenNthCalledWith(1, 30_000, undefined)
    expect(mockSleep).toHaveBeenNthCalledWith(2, 1_000, undefined)
  })

  it('rejects redirects without exposing their location or body', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(302, `redirect ${BASIC}`, { location: 'https://evil.example' })
    )
    const error = await requestOracleFusionJson(CREDENTIAL, {
      family: 'hcm',
      path: 'workers',
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 302 })
    expect(String(error)).not.toContain('evil.example')
    expect(String(error)).not.toContain(BASIC)
  })

  it('classifies redirects rejected by the pinned transport without exposing details', async () => {
    mockSecureFetch.mockRejectedValueOnce(new Error('Too many redirects (max: 0)'))
    const error = await requestOracleFusionJson(CREDENTIAL, {
      family: 'hcm',
      path: 'workers',
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ message: 'Oracle Fusion returned a redirect', status: 502 })
    expect(String(error)).not.toContain(ORIGIN)
    expect(String(error)).not.toContain(BASIC)
  })

  it('preserves unsafe integral JSON tokens as decimal strings', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      response(
        200,
        '{"id":9007199254740993,"negative":-9007199254740993,"zeroFraction":9007199254740993.0,"exponent":9.007199254740993e15,"hugeExponent":1e999,"safe":9007199254740991,"decimal":9007199254740993.5}'
      )
    )
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' })
    ).resolves.toEqual({
      id: '9007199254740993',
      negative: '-9007199254740993',
      zeroFraction: '9007199254740993.0',
      exponent: '9.007199254740993e15',
      hugeExponent: '1e999',
      safe: 9007199254740991,
      decimal: 9007199254740994,
    })
  })

  it('recognizes a large negative exponent absorbed by coefficient trailing zeroes', async () => {
    const token = `9007199254740993${'0'.repeat(1_000_000)}e-1000000`
    mockSecureFetch.mockResolvedValueOnce(response(200, `{"id":${token}}`))
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' })
    ).resolves.toEqual({ id: token })
  })

  it('returns fixed provider errors without credential or body reflection', async () => {
    const password = 'provider-reflected-password'
    const accessToken = Buffer.from(`integration-user:${password}`).toString('base64')
    mockSecureFetch.mockResolvedValueOnce(
      response(401, `integration-user ${password} ${accessToken}`)
    )
    const error = await requestOracleFusionJson(
      { ...CREDENTIAL, accessToken },
      { family: 'hcm', path: 'workers' }
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OracleFusionProviderError)
    expect(error).toMatchObject({ message: 'Oracle Fusion authentication failed', status: 401 })
    expect(String(error)).not.toContain('integration-user')
    expect(String(error)).not.toContain(password)
    expect(String(error)).not.toContain(accessToken)
  })

  it('classifies timeout, response-limit, and malformed JSON failures', async () => {
    mockSecureFetch.mockRejectedValueOnce(new Error('Request timed out after 30000ms'))
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' })
    ).rejects.toMatchObject({ message: 'Oracle Fusion request timed out', status: 504 })

    mockSecureFetch.mockRejectedValueOnce(
      new PayloadSizeLimitError({ label: 'response', maxBytes: 5 * 1024 * 1024 })
    )
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' })
    ).rejects.toMatchObject({ message: 'Oracle Fusion response exceeded 5 MiB', status: 502 })

    mockSecureFetch.mockResolvedValueOnce(response(200, 'not-json'))
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' })
    ).rejects.toMatchObject({ message: 'Oracle Fusion returned malformed JSON', status: 502 })
  })

  it('preserves caller aborts and never starts the request', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    controller.abort(reason)
    await expect(
      requestOracleFusionJson(CREDENTIAL, { family: 'hcm', path: 'workers' }, controller.signal)
    ).rejects.toBe(reason)
    expect(mockValidateUrl).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('rejects malformed Basic material and non-finite query values locally', async () => {
    await expect(
      requestOracleFusionJson(
        { ...CREDENTIAL, accessToken: 'not basic\r\n' },
        { family: 'hcm', path: 'workers' }
      )
    ).rejects.toThrow('credential is malformed')
    await expect(
      requestOracleFusionJson(CREDENTIAL, {
        family: 'hcm',
        path: 'workers',
        query: { limit: Number.POSITIVE_INFINITY },
      })
    ).rejects.toThrow('query values must be finite')
    expect(mockValidateUrl).not.toHaveBeenCalled()
  })
})
