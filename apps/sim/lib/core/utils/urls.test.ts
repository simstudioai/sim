/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEnv } = vi.hoisted(() => ({
  mockGetEnv: vi.fn<(key: string) => string | undefined>(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  getEnv: mockGetEnv,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isProd: false,
}))

import {
  getBrowserOrigin,
  getSocketUrl,
  isLocalhostUrl,
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
