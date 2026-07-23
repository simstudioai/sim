/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDnsLookup } = vi.hoisted(() => ({ mockDnsLookup: vi.fn() }))

vi.mock('dns/promises', () => ({ default: { lookup: mockDnsLookup } }))

/**
 * Query-suffixed import gives this file a private instance of the module under
 * test. Under `isolate: false` the worker's module graph is shared across test
 * files, so the plain specifier may already be cached with the real
 * `dns/promises` binding (mocks never reach an already-evaluated module) — and
 * evaluating it here under this file's mocks would poison it for later files.
 * The suffixed id is unique to this file, so it always evaluates fresh with
 * the mock above.
 */
declare module '@/lib/core/security/input-validation.server?ssrf-guarded-lookup-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient type re-declaration for the query-suffixed specifier, not a runtime export
  export * from '@/lib/core/security/input-validation.server'
}

import {
  createSsrfGuardedLookup,
  followRedirectsGuarded,
} from '@/lib/core/security/input-validation.server?ssrf-guarded-lookup-test'

type LookupResult = { address: string; family: number }

function runLookup(
  hostname: string,
  options: { all?: boolean } = {}
): Promise<{ err: Error | null; address?: string | LookupResult[]; family?: number }> {
  return new Promise((resolve) => {
    const lookup = createSsrfGuardedLookup()
    type LookupCb = (err: Error | null, address?: string | LookupResult[], family?: number) => void
    // double-cast-allowed: net.LookupFunction's overloaded callback shapes collapse to this in practice
    ;(lookup as unknown as (h: string, o: object, cb: LookupCb) => void)(
      hostname,
      options,
      (err: Error | null, address?: string | LookupResult[], family?: number) =>
        resolve({ err, address, family })
    )
  })
}

describe('createSsrfGuardedLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through a public address', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const r = await runLookup('example.com')
    expect(r.err).toBeNull()
    expect(r.address).toBe('93.184.216.34')
    expect(r.family).toBe(4)
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['RFC1918 10.x', '10.0.0.5'],
    ['RFC1918 192.168.x', '192.168.1.1'],
    ['link-local metadata', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['IPv4-mapped private', '::ffff:10.0.0.1'],
  ])('fails the connect when the host resolves only to %s', async (_label, ip) => {
    mockDnsLookup.mockResolvedValue([{ address: ip, family: ip.includes(':') ? 6 : 4 }])
    const r = await runLookup('rebind.attacker.example')
    expect(r.err?.message).toMatch(/Blocked by SSRF policy/)
  })

  it('filters private records out of a mixed answer and connects only to public ones', async () => {
    // A rebinding server can interleave private records with public ones; only the
    // public set may ever reach the socket.
    mockDnsLookup.mockResolvedValue([
      { address: '10.1.2.3', family: 4 },
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    const r = await runLookup('mixed.example', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toEqual([{ address: '93.184.216.34', family: 4 }])
  })

  it('re-validates on every call (no validated-then-trusted window)', async () => {
    // First resolution is public; the rebind flips to private — the second connect fails.
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    mockDnsLookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])

    const first = await runLookup('rebind.example')
    const second = await runLookup('rebind.example')

    expect(first.err).toBeNull()
    expect(second.err?.message).toMatch(/Blocked by SSRF policy/)
  })

  it('propagates DNS resolution failures', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'))
    const r = await runLookup('nope.invalid')
    expect(r.err?.message).toBe('ENOTFOUND')
  })

  it('returns the full public set for options.all (fallback across addresses)', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '104.21.22.105', family: 4 },
      { address: '172.67.204.95', family: 4 },
    ])
    const r = await runLookup('multi.example', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toHaveLength(2)
  })
})

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } })
}

describe('followRedirectsGuarded', () => {
  it('returns a non-redirect response as-is', async () => {
    const raw = vi.fn(async () => new Response('ok', { status: 200 }))
    const res = await followRedirectsGuarded(raw, 'https://a.example/x', {})
    expect(res.status).toBe(200)
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('follows a same-origin redirect and keeps the caller headers', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://a.example/y'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const res = await followRedirectsGuarded(raw, 'https://a.example/x', {
      headers: { 'x-api-key': 'secret' },
    })
    expect(res.status).toBe(200)
    expect(raw.mock.calls[1][0]).toBe('https://a.example/y')
    expect(raw.mock.calls[1][1].headers).toEqual({ 'x-api-key': 'secret' })
  })

  it('drops custom headers on a cross-origin redirect', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://b.example/harvest'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await followRedirectsGuarded(raw, 'https://a.example/x', {
      headers: { 'x-api-key': 'secret' },
    })
    expect(raw.mock.calls[1][1].headers).toBeUndefined()
  })

  it('blocks a redirect to a private IP literal (metadata endpoint)', async () => {
    const raw = vi.fn(async () => redirectTo('http://169.254.169.254/latest/meta-data/'))
    await expect(followRedirectsGuarded(raw, 'https://a.example/x', {})).rejects.toThrow(
      /Blocked by SSRF policy/
    )
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('blocks a redirect to a bracketed private IPv6 literal', async () => {
    const raw = vi.fn(async () => redirectTo('http://[::1]/admin'))
    await expect(followRedirectsGuarded(raw, 'https://a.example/x', {})).rejects.toThrow(
      /Blocked by SSRF policy/
    )
  })

  it('blocks non-http(s) redirect protocols', async () => {
    const raw = vi.fn(async () => redirectTo('file:///etc/passwd'))
    await expect(followRedirectsGuarded(raw, 'https://a.example/x', {})).rejects.toThrow(
      /unsupported protocol/
    )
  })

  it('caps the number of hops', async () => {
    const raw = vi.fn(async () => redirectTo('https://a.example/loop'))
    await expect(followRedirectsGuarded(raw, 'https://a.example/x', {})).rejects.toThrow(
      /more than \d+ redirects/
    )
  })

  it('switches POST to a bodyless GET on 303', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://a.example/next', 303))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await followRedirectsGuarded(raw, 'https://a.example/x', { method: 'POST', body: 'data' })
    expect(raw.mock.calls[1][1].method).toBe('GET')
    expect(raw.mock.calls[1][1].body).toBeUndefined()
  })

  it('preserves method and body on 307', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://a.example/next', 307))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await followRedirectsGuarded(raw, 'https://a.example/x', { method: 'POST', body: 'data' })
    expect(raw.mock.calls[1][1].method).toBe('POST')
    expect(raw.mock.calls[1][1].body).toBe('data')
  })
})

describe('followRedirectsGuarded — hardening', () => {
  it('blocks a private IP-literal as the INITIAL url (guard is self-contained)', async () => {
    const raw = vi.fn(async () => new Response('ok'))
    await expect(
      followRedirectsGuarded(raw, 'http://169.254.169.254/latest/meta-data/', {})
    ).rejects.toThrow(/Blocked by SSRF policy/)
    expect(raw).not.toHaveBeenCalled()
  })

  it('drops entity headers when a 303 switches POST to a bodyless GET', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://a.example/next', 303))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await followRedirectsGuarded(raw, 'https://a.example/x', {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json', 'content-length': '7', 'x-keep': 'yes' },
    })
    const hopHeaders = new Headers(raw.mock.calls[1][1].headers)
    expect(hopHeaders.get('content-type')).toBeNull()
    expect(hopHeaders.get('content-length')).toBeNull()
    expect(hopHeaders.get('x-keep')).toBe('yes')
  })
})

describe('followRedirectsGuarded — cross-origin body protection', () => {
  it('refuses a cross-origin 307 that would forward a request body', async () => {
    const raw = vi.fn(async () => redirectTo('https://b.example/steal', 307))
    await expect(
      followRedirectsGuarded(raw, 'https://a.example/token', {
        method: 'POST',
        body: 'client_secret=shh',
      })
    ).rejects.toThrow(/cross-origin redirect would forward a request body/)
  })

  it('allows a bodyless cross-origin redirect', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://b.example/next', 302))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const res = await followRedirectsGuarded(raw, 'https://a.example/x', {})
    expect(res.status).toBe(200)
  })
})
