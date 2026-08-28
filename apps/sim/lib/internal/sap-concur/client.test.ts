/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, MOCK_MAX_JSON_BYTES } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  MOCK_MAX_JSON_BYTES: 10 * 1024 * 1024,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetch,
  MAX_JSON_API_RESPONSE_BYTES: MOCK_MAX_JSON_BYTES,
}))

import {
  assertSafeExternalUrl,
  extractSapConcurError,
  fetchSapConcurAccessToken,
  forwardedSapConcurHeaders,
  invokeSapConcurMultipart,
} from '@/lib/internal/sap-concur/client'
import {
  SAP_CONCUR_ALLOWED_DATACENTERS,
  type SapConcurAuth,
  sapConcurApiInputSchema,
  sapConcurApiPathSchema,
  sapConcurDatacenterSchema,
} from '@/lib/internal/sap-concur/schema'

const CLIENT_SECRET = 'super-secret-client-value'
const PASSWORD = 'hunter2-plaintext-password'

/**
 * `TOKEN_CACHE` in the client is module-global and survives every test in this file, so
 * each case takes its own `clientId`. That guarantees a cold cache key for the case and
 * keeps one test's cached token from silently satisfying the next test's assertions.
 */
let clientIdCounter = 0
function freshClientId(): string {
  clientIdCounter += 1
  return `client-${clientIdCounter}`
}

function auth(overrides: Partial<SapConcurAuth> & { clientId: string }): SapConcurAuth {
  return {
    datacenter: 'us.api.concursolutions.com',
    grantType: 'client_credentials',
    clientSecret: CLIENT_SECRET,
    ...overrides,
  }
}

function tokenResponse(
  body: Record<string, unknown> = { access_token: 'token-1', expires_in: 3600 },
  status = 200
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // mockReset also drains any `mockResolvedValueOnce` a failing test left queued.
  mockSecureFetch.mockReset()
  mockSecureFetch.mockResolvedValue(tokenResponse())
})

describe('fetchSapConcurAccessToken token cache key isolation', () => {
  /**
   * Regression test for the auth-bypass: with the password absent from the cache key, a
   * request carrying the wrong password was served a token minted from the correct one.
   */
  it('does not share a cache entry across differing passwords', async () => {
    const clientId = freshClientId()
    const base = auth({
      clientId,
      grantType: 'password',
      username: 'alice@example.com',
    })

    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-correct', expires_in: 3600 })
    )
    const first = await fetchSapConcurAccessToken({ ...base, password: PASSWORD }, 'req-1')

    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-other', expires_in: 3600 })
    )
    const second = await fetchSapConcurAccessToken({ ...base, password: 'a-different-pw' }, 'req-2')

    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
    expect(first.accessToken).toBe('token-correct')
    expect(second.accessToken).toBe('token-other')
  })

  it('does not share a cache entry across differing client secrets', async () => {
    const clientId = freshClientId()
    const base = auth({ clientId })

    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-first-secret', expires_in: 3600 })
    )
    const first = await fetchSapConcurAccessToken(base, 'req-1')

    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-second-secret', expires_in: 3600 })
    )
    const second = await fetchSapConcurAccessToken(
      { ...base, clientSecret: 'a-different-client-secret' },
      'req-2'
    )

    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
    expect(first.accessToken).toBe('token-first-secret')
    expect(second.accessToken).toBe('token-second-secret')
  })

  it('does not share a cache entry across differing companyUuid', async () => {
    const clientId = freshClientId()
    const base = auth({ clientId })

    await fetchSapConcurAccessToken({ ...base, companyUuid: 'company-a' }, 'req-1')
    await fetchSapConcurAccessToken({ ...base, companyUuid: 'company-b' }, 'req-2')

    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
  })

  it('does not share a cache entry across differing credtype', async () => {
    const clientId = freshClientId()
    const base = auth({
      clientId,
      grantType: 'password',
      username: 'alice@example.com',
      password: PASSWORD,
    })

    await fetchSapConcurAccessToken({ ...base, credtype: 'password' }, 'req-1')
    await fetchSapConcurAccessToken({ ...base, credtype: 'authtoken' }, 'req-2')

    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
  })

  it('shares the cache for two fully identical requests', async () => {
    const clientId = freshClientId()
    const base = auth({
      clientId,
      grantType: 'password',
      username: 'alice@example.com',
      password: PASSWORD,
      companyUuid: 'company-a',
      credtype: 'password',
    })

    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-cached', expires_in: 3600 })
    )
    const first = await fetchSapConcurAccessToken({ ...base }, 'req-1')
    const second = await fetchSapConcurAccessToken({ ...base }, 'req-2')

    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
    expect(first.accessToken).toBe('token-cached')
    expect(second.accessToken).toBe('token-cached')
  })

  it('refetches once a cached token falls inside the 60s safety window', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const base = auth({ clientId: freshClientId() })

      mockSecureFetch.mockResolvedValueOnce(
        tokenResponse({ access_token: 'token-first', expires_in: 120 })
      )
      const first = await fetchSapConcurAccessToken(base, 'req-1')
      expect(first.accessToken).toBe('token-first')

      // 30s in: still outside the 60s safety window, so the cache answers.
      vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'))
      const cached = await fetchSapConcurAccessToken(base, 'req-2')
      expect(cached.accessToken).toBe('token-first')
      expect(mockSecureFetch).toHaveBeenCalledTimes(1)

      // 90s in: expiry (120s) minus the 60s window has passed, so it refetches.
      vi.setSystemTime(new Date('2026-01-01T00:01:30.000Z'))
      mockSecureFetch.mockResolvedValueOnce(
        tokenResponse({ access_token: 'token-second', expires_in: 3600 })
      )
      const refreshed = await fetchSapConcurAccessToken(base, 'req-3')
      expect(refreshed.accessToken).toBe('token-second')
      expect(mockSecureFetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * A parallel block fanning out many Concur calls, or a cold container after a deploy,
 * misses the token cache on every branch at once. Without coalescing each branch fires
 * its own `POST /oauth2/v0/token` into an endpoint Concur rate-limits hard.
 */
describe('fetchSapConcurAccessToken in-flight coalescing', () => {
  it('collapses concurrent misses for one key into a single token fetch', async () => {
    const base = auth({ clientId: freshClientId() })

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockSecureFetch.mockImplementation(async () => {
      await gate
      return tokenResponse({ access_token: 'token-shared', expires_in: 3600 })
    })

    const inFlight = Array.from({ length: 8 }, (_, index) =>
      fetchSapConcurAccessToken(base, `req-${index}`)
    )
    release()
    const results = await Promise.all(inFlight)

    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
    for (const result of results) {
      expect(result.accessToken).toBe('token-shared')
    }
  })

  it('does not collapse concurrent misses for different keys', async () => {
    const first = auth({ clientId: freshClientId() })
    const second = auth({ clientId: freshClientId() })

    await Promise.all([
      fetchSapConcurAccessToken(first, 'req-1'),
      fetchSapConcurAccessToken(second, 'req-2'),
    ])

    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
  })

  it('does not poison the key when the in-flight request rejects', async () => {
    const base = auth({ clientId: freshClientId() })

    mockSecureFetch.mockRejectedValueOnce(new Error('socket hang up'))
    const first = fetchSapConcurAccessToken(base, 'req-1')
    const joiner = fetchSapConcurAccessToken(base, 'req-2')

    await expect(first).rejects.toThrow('socket hang up')
    await expect(joiner).rejects.toThrow('socket hang up')

    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-after-retry', expires_in: 3600 })
    )
    const retried = await fetchSapConcurAccessToken(base, 'req-3')

    expect(retried.accessToken).toBe('token-after-retry')
    expect(mockSecureFetch).toHaveBeenCalledTimes(2)
  })

  it('keeps a shared token request alive until every waiting execution cancels', async () => {
    const base = auth({ clientId: freshClientId() })
    const firstController = new AbortController()
    const secondController = new AbortController()
    let providerSignal: AbortSignal | undefined

    mockSecureFetch.mockImplementationOnce(
      async (_url: string, options: { signal?: AbortSignal }) => {
        providerSignal = options.signal
        return await new Promise((_, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      }
    )

    const first = fetchSapConcurAccessToken(base, 'req-1', firstController.signal)
    const second = fetchSapConcurAccessToken(base, 'req-2', secondController.signal)
    firstController.abort(new DOMException('First cancelled', 'AbortError'))

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(providerSignal?.aborted).toBe(false)

    secondController.abort(new DOMException('Second cancelled', 'AbortError'))
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(providerSignal?.aborted).toBe(true)
    expect(mockSecureFetch).toHaveBeenCalledOnce()
  })
})

describe('fetchSapConcurAccessToken geolocation validation', () => {
  const accepted = [
    'https://us.api.concursolutions.com',
    'https://www-us2.api.concursolutions.com',
    'https://apj1.api.concursolutions.com',
    'https://emea-impl.api.concursolutions.com',
  ]

  it.each(accepted)('accepts the Concur geolocation %s', async (geolocation) => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-1', expires_in: 3600, geolocation })
    )
    const result = await fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    expect(result.geolocation).toBe(geolocation)
  })

  const rejected: Array<[string, string]> = [
    ['an unrelated host', 'https://evil.com'],
    ['a suffix-confusion host', 'https://concursolutions.com.evil.com'],
    ['a subdomain-confusion host', 'https://us.api.concursolutions.com.evil.com'],
  ]

  it.each(rejected)('rejects %s', async (_label, geolocation) => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-1', expires_in: 3600, geolocation })
    )
    await expect(
      fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    ).rejects.toThrow('not a valid Concur API host')
  })

  it('rejects a plain-http geolocation', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: 'token-1',
        expires_in: 3600,
        geolocation: 'http://us.api.concursolutions.com',
      })
    )
    await expect(
      fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    ).rejects.toThrow('geolocation must use https://')
  })

  it('rejects a loopback geolocation', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-1', expires_in: 3600, geolocation: 'https://127.0.0.1' })
    )
    await expect(
      fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    ).rejects.toThrow('geolocation host is not allowed')
  })

  it('normalizes a bare hostname to https and still validates it', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: 'token-1',
        expires_in: 3600,
        geolocation: 'us2.api.concursolutions.com',
      })
    )
    const result = await fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    expect(result.geolocation).toBe('https://us2.api.concursolutions.com')
  })

  it('rejects a bare hostname that normalizes to a non-Concur host', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-1', expires_in: 3600, geolocation: 'evil.com' })
    )
    await expect(
      fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    ).rejects.toThrow('not a valid Concur API host')
  })

  /**
   * DOCUMENTED TRUST ASSUMPTION, asserted as current behavior on purpose: the geolocation
   * check validates the *shape* `[label].api.concursolutions.com`, not membership in
   * {@link SAP_CONCUR_ALLOWED_DATACENTERS}. That is deliberate — Concur's docs instruct
   * clients to store and reuse whatever geolocation the token response returns, and SAP
   * adds datacenters (GLZ was one) without clients redeploying, so pinning the response
   * to the selectable set would break tenants on a new datacenter.
   *
   * The consequence is that an attacker-flavored label like `evil-us` is accepted. Such a
   * host can only exist if SAP itself creates it under concursolutions.com, which puts it
   * inside the same trust boundary as every other Concur host. Narrowing this to the
   * allowlist is a deliberate product decision, not a bug fix — do not "harden" it
   * without re-reading the geolocation guidance in the authentication docs.
   */
  it('accepts any SAP-created label under api.concursolutions.com (trust boundary is the domain)', async () => {
    const geolocation = 'https://evil-us.api.concursolutions.com'
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-1', expires_in: 3600, geolocation })
    )
    const result = await fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    expect(result.geolocation).toBe(geolocation)
  })

  it('rejects a userinfo-form geolocation whose real hostname is attacker-controlled', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: 'token-1',
        expires_in: 3600,
        geolocation: 'https://us.api.concursolutions.com@evil.com',
      })
    )
    await expect(
      fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    ).rejects.toThrow('not a valid Concur API host')
  })

  it('accepts a Concur host carrying an explicit port and preserves it', async () => {
    const geolocation = 'https://us.api.concursolutions.com:8443'
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ access_token: 'token-1', expires_in: 3600, geolocation })
    )
    const result = await fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    expect(result.geolocation).toBe(geolocation)
  })

  it('rejects a non-Concur host even when the port looks Concur-shaped', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({
        access_token: 'token-1',
        expires_in: 3600,
        geolocation: 'https://evil.com:443',
      })
    )
    await expect(
      fetchSapConcurAccessToken(auth({ clientId: freshClientId() }), 'req-1')
    ).rejects.toThrow('not a valid Concur API host')
  })
})

/**
 * Concur's company-level flow is a password grant that carries the company UUID in
 * `username`, the 24-hour App Center request token in `password`, and `credtype=authtoken`.
 */
describe('fetchSapConcurAccessToken company-level auth', () => {
  function submittedParams(): URLSearchParams {
    const [, init] = mockSecureFetch.mock.calls[0]
    return new URLSearchParams(init.body as string)
  }

  it('submits the companyUuid as username and defaults credtype to authtoken', async () => {
    await fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        password: 'company-request-token',
        companyUuid: '08BCCA1E-0D4F-4261-9F1B-F778D96617D6',
      }),
      'req-1'
    )

    const params = submittedParams()
    expect(params.get('grant_type')).toBe('password')
    expect(params.get('username')).toBe('08BCCA1E-0D4F-4261-9F1B-F778D96617D6')
    expect(params.get('password')).toBe('company-request-token')
    expect(params.get('credtype')).toBe('authtoken')
  })

  it('lets an explicit credtype override the company-flow default', async () => {
    await fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        password: 'company-request-token',
        companyUuid: 'company-uuid-1',
        credtype: 'password',
      }),
      'req-1'
    )

    expect(submittedParams().get('credtype')).toBe('password')
  })

  it('prefers the companyUuid over a supplied username', async () => {
    await fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        username: 'alice@example.com',
        password: 'company-request-token',
        companyUuid: 'company-uuid-2',
      }),
      'req-1'
    )

    expect(submittedParams().get('username')).toBe('company-uuid-2')
  })

  it('leaves the user-level password grant untouched (no credtype, real username)', async () => {
    await fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        username: 'alice@example.com',
        password: PASSWORD,
      }),
      'req-1'
    )

    const params = submittedParams()
    expect(params.get('username')).toBe('alice@example.com')
    expect(params.has('credtype')).toBe(false)
  })

  it('requires a username or a companyUuid for a password grant', async () => {
    await expect(
      fetchSapConcurAccessToken(
        auth({ clientId: freshClientId(), grantType: 'password', password: PASSWORD }),
        'req-1'
      )
    ).rejects.toThrow('username is required for password grant')
  })
})

describe('fetchSapConcurAccessToken secret handling', () => {
  it('never puts the clientSecret or password into a token-fetch error message', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      tokenResponse({ error: 'invalid_grant', error_description: 'Bad credentials' }, 401)
    )

    const promise = fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        username: 'alice@example.com',
        password: PASSWORD,
      }),
      'req-1'
    )

    await expect(promise).rejects.toThrow('Concur token request failed: invalid_grant')
    const error = await promise.catch((e: Error) => e)
    expect(error.message).not.toContain(CLIENT_SECRET)
    expect(error.message).not.toContain(PASSWORD)
  })

  /**
   * The token request body is form-encoded `client_id=…&client_secret=…&password=…`, so an
   * intermediary that rejects the request and echoes it back would otherwise have its page
   * surfaced verbatim. The raw fallback is capped on the token path for that reason.
   */
  it('truncates an unstructured token-error body instead of echoing it back', async () => {
    const echoedRequest = `<html><body>Request blocked by proxy. Your request was: POST /oauth2/v0/token client_id=abc&client_secret=${CLIENT_SECRET}&grant_type=password&username=alice@example.com&password=${PASSWORD}&credtype=password. Contact your administrator with reference id 0000-1111-2222-3333 for further assistance with this policy decision.</body></html>`

    mockSecureFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => echoedRequest,
    })

    const error = await fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        username: 'alice@example.com',
        password: PASSWORD,
      }),
      'req-1'
    ).catch((e: Error) => e)

    expect(error.message).not.toContain(CLIENT_SECRET)
    expect(error.message).not.toContain(PASSWORD)
    expect(error.message.length).toBeLessThan(echoedRequest.length)
    expect(error.message).toContain('Request blocked by proxy')
  })

  it('never leaks credentials when the outbound fetch itself throws', async () => {
    mockSecureFetch.mockRejectedValueOnce(new Error('socket hang up'))

    const error = await fetchSapConcurAccessToken(
      auth({
        clientId: freshClientId(),
        grantType: 'password',
        username: 'alice@example.com',
        password: PASSWORD,
      }),
      'req-1'
    ).catch((e: Error) => e)

    expect(error.message).not.toContain(CLIENT_SECRET)
    expect(error.message).not.toContain(PASSWORD)
  })
})

describe('sapConcurApiPathSchema', () => {
  const accepted = [
    '/expensereports/v4/reports/abc123',
    'expensereports/v4/reports/abc123',
    '/profile/v1/principals/1234-5678',
  ]

  it.each(accepted)('accepts the ordinary path %s', (path) => {
    expect(sapConcurApiPathSchema.safeParse(path).success).toBe(true)
  })

  const rejected = [
    '/expensereports/../../etc/passwd',
    '/expensereports/./v4/reports',
    '..',
    '/expensereports\\..\\v4',
    '/expensereports/v4#fragment',
    '/expensereports/%2e%2e/v4',
    '/expensereports/%2E%2E/v4',
    '/expensereports%2fv4',
    '/expensereports%5cv4',
    '/expensereports%23v4',
  ]

  it.each(rejected)('rejects the traversal-shaped path %s', (path) => {
    expect(sapConcurApiPathSchema.safeParse(path).success).toBe(false)
  })

  /**
   * KNOWN LIMITATION, asserted as current behavior on purpose: the refine only inspects
   * one layer of percent-encoding, so a double-encoded `%252e%252e` passes. That is
   * acceptable because the refine is defense-in-depth — the request host is still pinned
   * by `assertSafeExternalUrl` against the validated Concur geolocation, so a decoded
   * `..` can at worst walk within concursolutions.com and cannot reach another origin.
   * Do not "fix" this here without re-checking the host pinning that backs it.
   */
  it('does not reject double-encoded traversal (defense-in-depth, host is pinned elsewhere)', () => {
    expect(sapConcurApiPathSchema.safeParse('/expensereports/%252e%252e/v4').success).toBe(true)
  })
})

describe('sapConcurApiInputSchema accept', () => {
  function parse(overrides: Record<string, unknown>) {
    return sapConcurApiInputSchema.parse({
      clientId: 'client-1',
      clientSecret: CLIENT_SECRET,
      path: '/expensereports/v4/reports',
      ...overrides,
    })
  }

  it('leaves accept undefined so callConcur applies its application/json default', () => {
    expect(parse({}).accept).toBeUndefined()
  })

  /** Itinerary and Travel Profile are XML-only and 406 an Accept they cannot satisfy. */
  it('carries an explicit XML accept through', () => {
    expect(parse({ accept: 'application/xml' }).accept).toBe('application/xml')
  })
})

/**
 * The executor retries 429/5xx for a block with a retry config and paces itself off
 * `Retry-After`; dropping the header downgrades a precise wait to blind backoff.
 */
describe('forwardedSapConcurHeaders', () => {
  it('forwards Retry-After, Location, and Link', () => {
    expect(
      forwardedSapConcurHeaders(
        new Headers({
          'Retry-After': '30',
          Location: 'https://us.api.concursolutions.com/receipts/v4/receipts/abc',
          Link: '<https://us.api.concursolutions.com/next>; rel="next"',
        })
      )
    ).toEqual({
      'retry-after': '30',
      location: 'https://us.api.concursolutions.com/receipts/v4/receipts/abc',
      link: '<https://us.api.concursolutions.com/next>; rel="next"',
    })
  })

  it('omits headers Concur did not send', () => {
    expect(forwardedSapConcurHeaders(new Headers({ 'Retry-After': '5' }))).toEqual({
      'retry-after': '5',
    })
  })

  it('forwards nothing when no interesting header is present', () => {
    expect(forwardedSapConcurHeaders(new Headers({ 'Content-Type': 'application/json' }))).toEqual(
      {}
    )
  })
})

describe('invokeSapConcurMultipart request cap', () => {
  it('rejects the serialized multipart body before provider I/O when it exceeds the cap', async () => {
    const formData = new FormData()
    formData.append('file', new Blob(['receipt']), 'receipt.txt')

    await expect(
      invokeSapConcurMultipart(
        'https://us.api.concursolutions.com/receipts/v4/upload',
        'access-token',
        formData,
        1
      )
    ).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      label: 'Concur multipart request',
      maxBytes: 1,
    })
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })
})

describe('sapConcurDatacenterSchema', () => {
  /** Every host in the published Base URIs table, plus the legacy `eu`/`emea` aliases. */
  const accepted = [
    'us.api.concursolutions.com',
    'www-us.api.concursolutions.com',
    'us2.api.concursolutions.com',
    'www-us2.api.concursolutions.com',
    'eu.api.concursolutions.com',
    'eu2.api.concursolutions.com',
    'www-eu2.api.concursolutions.com',
    'emea.api.concursolutions.com',
    'www-emea.api.concursolutions.com',
    'apj1.api.concursolutions.com',
    'www-apj1.api.concursolutions.com',
    'usg.api.concursolutions.com',
    'www-usg.api.concursolutions.com',
    'glz.api.concursolutions.com',
    'us-impl.api.concursolutions.com',
    'www-us-impl.api.concursolutions.com',
    'emea-impl.api.concursolutions.com',
    'www-emea-impl.api.concursolutions.com',
  ]

  it.each(accepted)('accepts the documented datacenter %s', (datacenter) => {
    expect(sapConcurDatacenterSchema.safeParse(datacenter).success).toBe(true)
  })

  it('covers exactly the documented set with no extras', () => {
    expect([...SAP_CONCUR_ALLOWED_DATACENTERS].sort()).toEqual([...accepted].sort())
  })

  /** GLZ is the one production row the Base URIs table publishes without a `www-` twin. */
  it('does not offer a www- twin for GLZ', () => {
    expect(sapConcurDatacenterSchema.safeParse('www-glz.api.concursolutions.com').success).toBe(
      false
    )
  })

  const rejected = [
    'evil.com',
    'us.api.concursolutions.com.evil.com',
    'evil-us.api.concursolutions.com',
    'https://us.api.concursolutions.com',
  ]

  it.each(rejected)('rejects the non-selectable datacenter %s', (datacenter) => {
    expect(sapConcurDatacenterSchema.safeParse(datacenter).success).toBe(false)
  })
})

describe('assertSafeExternalUrl', () => {
  it('accepts a normal Concur https URL', () => {
    const url = assertSafeExternalUrl('https://us.api.concursolutions.com/expense/v4', 'apiUrl')
    expect(url.hostname).toBe('us.api.concursolutions.com')
  })

  it('rejects a non-URL', () => {
    expect(() => assertSafeExternalUrl('not a url', 'apiUrl')).toThrow('must be a valid URL')
  })

  it('rejects a non-https scheme', () => {
    expect(() => assertSafeExternalUrl('http://us.api.concursolutions.com', 'apiUrl')).toThrow(
      'must use https://'
    )
  })

  const forbiddenHosts = [
    'https://localhost/x',
    'https://0.0.0.0/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/x',
    'https://[::1]/x',
  ]

  it.each(forbiddenHosts)('rejects the metadata/loopback host %s', (url) => {
    expect(() => assertSafeExternalUrl(url, 'apiUrl')).toThrow('is not allowed')
  })

  const privateIps = ['https://10.0.0.5/x', 'https://192.168.1.10/x', 'https://172.16.4.4/x']

  it.each(privateIps)('rejects the private IP %s', (url) => {
    expect(() => assertSafeExternalUrl(url, 'apiUrl')).toThrow('private/loopback range')
  })
})

describe('extractSapConcurError', () => {
  it('combines the OAuth error and error_description', () => {
    expect(
      extractSapConcurError({ error: 'invalid_client', error_description: 'Bad client id' }, 401)
    ).toBe('invalid_client: Bad client id')
  })

  it('includes the Expense v4 errorMessage with its validation details', () => {
    const message = extractSapConcurError(
      {
        errorMessage: 'Report is not valid',
        validationErrors: [{ message: 'purpose is required' }, { message: 'amount must be > 0' }],
      },
      400
    )
    expect(message).toContain('Report is not valid')
    expect(message).toContain('purpose is required')
    expect(message).toContain('amount must be > 0')
  })

  it('returns a bare Expense v4 errorMessage when there are no validation errors', () => {
    expect(extractSapConcurError({ errorMessage: 'Report is not valid' }, 400)).toBe(
      'Report is not valid'
    )
  })

  it('prefixes the SCIM detail with the scimType', () => {
    expect(
      extractSapConcurError({ scimType: 'invalidValue', detail: 'userName already exists' }, 409)
    ).toBe('[invalidValue] userName already exists')
  })

  it('returns a SCIM detail without a scimType', () => {
    expect(extractSapConcurError({ detail: 'userName already exists' }, 409)).toBe(
      'userName already exists'
    )
  })

  it('reads the legacy nested Content.Error.Message envelope', () => {
    expect(
      extractSapConcurError({ Content: { Error: { Message: 'Invalid report key' } } }, 400)
    ).toBe('Invalid report key')
  })

  it('reads the legacy top-level Error.Message envelope', () => {
    expect(extractSapConcurError({ Error: { Message: 'Invalid itinerary' } }, 400)).toBe(
      'Invalid itinerary'
    )
  })

  it('includes the token-error code alongside the OAuth error', () => {
    expect(
      extractSapConcurError(
        { code: 16, error: 'invalid_request', error_description: 'user lives elsewhere' },
        400
      )
    ).toBe('[16] invalid_request: user lives elsewhere')
  })

  it('accepts a string-typed token-error code', () => {
    expect(extractSapConcurError({ code: '53', error: 'invalid_grant' }, 400)).toBe(
      '[53] invalid_grant'
    )
  })

  /** Budget v4 (Budget Category) failure response, verbatim from the API reference. */
  it('joins the Budget v4 errorMessageList with its types and codes', () => {
    expect(
      extractSapConcurError(
        {
          status: false,
          errorMessageList: [
            {
              errorType: 'ERROR',
              errorCode: 'BUDGET.BUDGET_CATEGORY_NAME_REQUIRED',
              errorMessage: 'Budget category name is required',
            },
            {
              errorType: 'ERROR',
              errorCode: 'BUDGET.BUDGET_CATEGORY_NAME_UNIQUE_ERROR',
              errorMessage: 'Budget category must have a unique name',
            },
          ],
        },
        400
      )
    ).toBe(
      '[ERROR BUDGET.BUDGET_CATEGORY_NAME_REQUIRED] Budget category name is required; ' +
        '[ERROR BUDGET.BUDGET_CATEGORY_NAME_UNIQUE_ERROR] Budget category must have a unique name'
    )
  })

  /** Budget Adjustments v4 nests the same object one level down under `message`. */
  it('unwraps an object-valued message to reach a nested errorMessageList', () => {
    expect(
      extractSapConcurError(
        {
          message: {
            status: false,
            errorMessageList: [
              {
                errorType: 'ERROR',
                errorCode: 'BUDGET.BUDGET_PERIOD_REQUIRED',
                errorMessage: 'Record 1) Budget period is missing',
              },
            ],
          },
        },
        400
      )
    ).toBe('[ERROR BUDGET.BUDGET_PERIOD_REQUIRED] Record 1) Budget period is missing')
  })

  it('still prefers a string-valued message over the legacy envelope', () => {
    expect(extractSapConcurError({ message: 'Report not found' }, 404)).toBe('Report not found')
  })

  it('falls back to the Concur SCIM messages extension when detail is absent', () => {
    expect(
      extractSapConcurError(
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '400',
          'urn:ietf:params:scim:api:messages:concur:2.0:Error': {
            messages: [
              {
                code: 'ATTRIBUTE_REQUIRED',
                message: 'userName is required',
                schemaPath: 'userName',
                type: 'error',
              },
            ],
          },
        },
        400
      )
    ).toBe('[ATTRIBUTE_REQUIRED] userName is required (userName)')
  })

  it('prefers the SCIM detail over the messages extension when both are present', () => {
    expect(
      extractSapConcurError(
        {
          detail: 'userName already exists',
          'urn:ietf:params:scim:api:messages:concur:2.0:Error': {
            messages: [{ code: 'DUP', message: 'duplicate', type: 'error' }],
          },
        },
        409
      )
    ).toBe('userName already exists')
  })

  it('joins an errors list with its error codes', () => {
    expect(
      extractSapConcurError(
        {
          errors: [
            { errorCode: 'E1', errorMessage: 'first problem' },
            { errorCode: 'E2', errorMessage: 'second problem' },
          ],
        },
        400
      )
    ).toBe('[E1] first problem; [E2] second problem')
  })

  it('passes a raw string body through when no cap is set', () => {
    expect(extractSapConcurError('Service Unavailable', 503)).toBe('Service Unavailable')
  })

  it('caps a raw string body when maxRawBodyLength is set', () => {
    expect(extractSapConcurError('x'.repeat(500), 503, { maxRawBodyLength: 20 })).toBe(
      `${'x'.repeat(20)}...`
    )
  })

  it('leaves a structured body uncapped even when maxRawBodyLength is set', () => {
    expect(extractSapConcurError({ error: 'invalid_client' }, 401, { maxRawBodyLength: 5 })).toBe(
      'invalid_client'
    )
  })

  it('falls back to the generic HTTP message for an unrecognized shape', () => {
    expect(extractSapConcurError({ unexpected: true }, 418)).toBe(
      'Concur request failed with HTTP 418'
    )
  })

  it('falls back to the generic HTTP message for an empty body', () => {
    expect(extractSapConcurError('', 500)).toBe('Concur request failed with HTTP 500')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
