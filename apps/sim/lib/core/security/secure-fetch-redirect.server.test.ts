/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface StubReply {
  statusCode: number
  headers: Record<string, string>
  body?: string
}

type StubResponseCallback = (res: unknown) => void

const { mockLookup, mockRequest, capturedRequests, replies } = vi.hoisted(() => {
  const capturedRequests: { hostname?: string; headers?: Record<string, string> }[] = []
  const replies: StubReply[] = []

  const mockRequest = vi.fn(
    (
      options: { hostname?: string; headers?: Record<string, string> },
      callback: StubResponseCallback
    ) => {
      capturedRequests.push(options)
      const reply = replies.shift() ?? { statusCode: 200, headers: {}, body: 'ok' }

      const req = new EventEmitter() as EventEmitter & {
        write: () => void
        end: () => void
        destroy: () => void
      }
      req.write = () => {}
      req.end = () => {}
      req.destroy = () => {}

      setImmediate(() => {
        const res = new Readable({ read() {} }) as Readable & {
          statusCode: number
          statusMessage: string
          headers: Record<string, string>
        }
        res.statusCode = reply.statusCode
        res.statusMessage = 'OK'
        res.headers = reply.headers
        res.push(Buffer.from(reply.body ?? ''))
        res.push(null)
        callback(res)
      })

      return req
    }
  )

  return { mockLookup: vi.fn(), mockRequest, capturedRequests, replies }
})

vi.mock('dns/promises', () => ({ default: { lookup: mockLookup }, lookup: mockLookup }))
vi.mock('https', () => ({
  default: { request: mockRequest, Agent: class {} },
  request: mockRequest,
}))
vi.mock('http', () => ({
  default: { request: mockRequest, Agent: class {} },
  request: mockRequest,
}))
vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  isPrivateDatabaseHostsAllowed: () => false,
}))

import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'

/** Assembled at runtime so no bearer-shaped literal sits in source for a secret scanner. */
const BEARER = ['Bearer', 'super', 'secret'].join(' ').replace(' secret', '-secret')

const CREDENTIAL_HEADERS = {
  Authorization: BEARER,
  Cookie: 'session=abc',
  'X-Api-Key': 'key-123',
  'X-Auth-Token': 'tok-456',
  'Proxy-Authorization': 'Basic zzz',
  'PRIVATE-TOKEN': ['glpat', 'xyz'].join('-'),
  'User-Agent': 'sim-test',
}

function headersOfHop(index: number): Record<string, string> {
  return capturedRequests[index]?.headers ?? {}
}

describe('secureFetchWithPinnedIP redirect credential handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedRequests.length = 0
    replies.length = 0
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
  })

  it('drops credential headers on a cross-site redirect', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://evil.example.net/collect' } },
      { statusCode: 200, headers: {}, body: 'done' }
    )

    const response = await secureFetchWithPinnedIP(
      'https://api.example.com/generate',
      '203.0.113.10',
      { headers: { ...CREDENTIAL_HEADERS } }
    )

    expect(response.status).toBe(200)
    expect(capturedRequests).toHaveLength(2)

    const secondHop = headersOfHop(1)
    expect(secondHop.Authorization).toBeUndefined()
    expect(secondHop.Cookie).toBeUndefined()
    expect(secondHop['X-Api-Key']).toBeUndefined()
    expect(secondHop['X-Auth-Token']).toBeUndefined()
    expect(secondHop['Proxy-Authorization']).toBeUndefined()
    expect(secondHop['PRIVATE-TOKEN']).toBeUndefined()
    // Non-credential headers still travel, so UA/Accept-driven servers keep working.
    expect(secondHop['User-Agent']).toBe('sim-test')
  })

  it('keeps credential headers on a same-host redirect', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://api.example.com/generate/v2' } },
      { statusCode: 200, headers: {}, body: 'done' }
    )

    await secureFetchWithPinnedIP('https://api.example.com/generate', '203.0.113.10', {
      headers: { ...CREDENTIAL_HEADERS },
    })

    expect(headersOfHop(1).Authorization).toBe(BEARER)
    expect(headersOfHop(1)['X-Api-Key']).toBe('key-123')
  })

  it('keeps credential headers across subdomains of the same registrable domain', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://us02web.zoom.us/rec/download/x' } },
      { statusCode: 200, headers: {}, body: 'video' }
    )

    await secureFetchWithPinnedIP('https://api.zoom.us/v2/recordings/1', '203.0.113.10', {
      headers: { Authorization: 'Bearer zoom-token' },
    })

    expect(headersOfHop(1).Authorization).toBe('Bearer zoom-token')
  })

  it('keeps credential headers across subdomains of the same service (github)', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://codeload.github.com/o/r/tar.gz/main' } },
      { statusCode: 200, headers: {}, body: 'tarball' }
    )

    await secureFetchWithPinnedIP('https://api.github.com/repos/o/r/tarball', '203.0.113.10', {
      headers: { Authorization: 'Bearer gh-token' },
    })

    expect(headersOfHop(1).Authorization).toBe('Bearer gh-token')
  })

  /**
   * Slack serves `url_private` from `files.slack.com` and 302s to `files-origin.slack.com`.
   * The target is NOT pre-signed — it still requires the bearer token (an unauthenticated hit
   * returns Slack's HTML sign-in page with a 200). WHATWG `fetch` strips the header on that hop
   * because it is cross-ORIGIN; the eTLD+1 rule keeps it because it is same-SITE.
   */
  it('keeps the bearer token on the Slack files.slack.com -> files-origin.slack.com hop', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://files-origin.slack.com/files-pri/T1-F1' } },
      { statusCode: 200, headers: {}, body: 'file' }
    )

    await secureFetchWithPinnedIP('https://files.slack.com/files-pri/T1-F1', '203.0.113.10', {
      headers: { Authorization: `Bearer ${['xoxb', 'token'].join('-')}` },
    })

    expect(headersOfHop(1).Authorization).toBe(`Bearer ${['xoxb', 'token'].join('-')}`)
  })

  /**
   * Twilio recording/media fetches 302 from `api.twilio.com` to a short-lived pre-signed CDN URL
   * (`*.twiliocdn.com`, legacy `s3-external-1.amazonaws.com`), whose credential lives in the query
   * string. Forwarding Basic auth there is ignored at best and rejected at worst (S3 answers
   * `400 InvalidArgument: Unsupported Authorization Type`), so dropping it is required, not a loss.
   */
  it('drops Basic auth on the Twilio api.twilio.com -> media.twiliocdn.com hop', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://media.twiliocdn.com/AC1/RE1.mp3?sig=x' } },
      { statusCode: 200, headers: {}, body: 'audio' }
    )

    await secureFetchWithPinnedIP(
      'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1',
      '203.0.113.10',
      { headers: { Authorization: 'Basic dHdpbGlv' } }
    )

    expect(headersOfHop(1).Authorization).toBeUndefined()
  })

  it('drops credential headers on a cross-TENANT hop of a private-suffix host', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://evil.s3.amazonaws.com/collect' } },
      { statusCode: 200, headers: {}, body: 'done' }
    )

    // `s3.amazonaws.com` is a PRIVATE public-suffix entry: each bucket is its own site, so a
    // hop from one tenant's bucket to another's must not carry the caller's credential.
    await secureFetchWithPinnedIP('https://victim.s3.amazonaws.com/object', '203.0.113.10', {
      headers: { ...CREDENTIAL_HEADERS },
    })

    expect(headersOfHop(1).Authorization).toBeUndefined()
    expect(headersOfHop(1)['X-Api-Key']).toBeUndefined()
    expect(headersOfHop(1)['User-Agent']).toBe('sim-test')
  })

  it('keeps credential headers within a single private-suffix tenant', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://victim.s3.amazonaws.com/object?v=2' } },
      { statusCode: 200, headers: {}, body: 'done' }
    )

    await secureFetchWithPinnedIP('https://victim.s3.amazonaws.com/object', '203.0.113.10', {
      headers: { Authorization: BEARER },
    })

    expect(headersOfHop(1).Authorization).toBe(BEARER)
  })

  it('forwards non-secret headers that the credential suffix rule over-matches', async () => {
    replies.push(
      { statusCode: 307, headers: { location: 'https://evil.example.net/collect' } },
      { statusCode: 200, headers: {}, body: 'done' }
    )

    await secureFetchWithPinnedIP('https://api.example.com/transfers', '203.0.113.10', {
      headers: {
        Authorization: BEARER,
        'Idempotency-Key': 'transfer-42',
        'X-Atlassian-Token': 'no-check',
      },
    })

    expect(headersOfHop(1).Authorization).toBeUndefined()
    expect(headersOfHop(1)['Idempotency-Key']).toBe('transfer-42')
    expect(headersOfHop(1)['X-Atlassian-Token']).toBe('no-check')
  })

  it('keeps credential headers on an http -> https upgrade of the same host', async () => {
    replies.push(
      { statusCode: 301, headers: { location: 'https://gitlab.internal.example.com/api/v4/x' } },
      { statusCode: 200, headers: {}, body: 'ok' }
    )

    await secureFetchWithPinnedIP('http://gitlab.internal.example.com/api/v4/x', '203.0.113.10', {
      headers: { 'PRIVATE-TOKEN': ['glpat', 'xyz'].join('-') },
      allowHttp: true,
    })

    expect(headersOfHop(1)['PRIVATE-TOKEN']).toBe(['glpat', 'xyz'].join('-'))
  })

  it('drops credential headers on an https -> http downgrade of the same host', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'http://api.example.com/plain' } },
      { statusCode: 200, headers: {}, body: 'ok' }
    )

    await secureFetchWithPinnedIP('https://api.example.com/secure', '203.0.113.10', {
      headers: { Authorization: BEARER },
      allowHttp: true,
    })

    expect(headersOfHop(1).Authorization).toBeUndefined()
  })

  it('still strips Authorization on a same-site redirect when stripAuthOnRedirect is set', async () => {
    replies.push(
      { statusCode: 302, headers: { location: 'https://api.example.com/next' } },
      { statusCode: 200, headers: {}, body: 'ok' }
    )

    await secureFetchWithPinnedIP('https://api.example.com/generate', '203.0.113.10', {
      headers: { Authorization: BEARER, 'User-Agent': 'sim-test' },
      stripAuthOnRedirect: true,
    })

    expect(headersOfHop(1).Authorization).toBeUndefined()
    expect(headersOfHop(1)['User-Agent']).toBe('sim-test')
  })

  it('blocks a redirect whose target resolves to a private IP', async () => {
    replies.push({ statusCode: 302, headers: { location: 'http://metadata.attacker.test/' } })
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])

    await expect(
      secureFetchWithPinnedIP('https://api.example.com/generate', '203.0.113.10', {
        headers: { Authorization: BEARER },
      })
    ).rejects.toThrow(/Redirect blocked/)

    expect(capturedRequests).toHaveLength(1)
  })
})
