/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getGitLabApiBase, normalizeGitLabHost, UnsafeGitLabHostError } from '@/tools/gitlab/utils'

describe('normalizeGitLabHost', () => {
  it('defaults to gitlab.com when the host is empty, blank, or not a string', () => {
    expect(normalizeGitLabHost(undefined)).toBe('gitlab.com')
    expect(normalizeGitLabHost(null)).toBe('gitlab.com')
    expect(normalizeGitLabHost('')).toBe('gitlab.com')
    expect(normalizeGitLabHost('   ')).toBe('gitlab.com')
    expect(normalizeGitLabHost(42)).toBe('gitlab.com')
  })

  it('strips protocol and trailing slashes from a self-managed host', () => {
    expect(normalizeGitLabHost('gitlab.example.com')).toBe('gitlab.example.com')
    expect(normalizeGitLabHost('https://gitlab.example.com')).toBe('gitlab.example.com')
    expect(normalizeGitLabHost('http://gitlab.example.com/')).toBe('gitlab.example.com')
    expect(normalizeGitLabHost('  https://gitlab.example.com//  ')).toBe('gitlab.example.com')
  })

  it('preserves an explicit port and IDN punycode labels', () => {
    expect(normalizeGitLabHost('gitlab.example.com:8443')).toBe('gitlab.example.com:8443')
    expect(normalizeGitLabHost('xn--80ak6aa92e.com')).toBe('xn--80ak6aa92e.com')
  })

  it('rejects hosts that could redirect the request authority (SSRF / token exfiltration)', () => {
    const unsafe = [
      'legit.com@evil.com',
      'user:pass@evil.com',
      'gitlab.com#@evil.com',
      'gitlab.com /api',
      'line\nbreak.com',
      'evil.com/path',
      'evil.com?x=1',
      '[::1]',
      'a..b.com',
      '.gitlab.com',
      'gitlab.com.',
    ]
    for (const host of unsafe) {
      expect(() => normalizeGitLabHost(host), host).toThrow(UnsafeGitLabHostError)
    }
  })

  it('accepts bare IP literals at the STRUCTURAL layer by design (private/metadata IPs are rejected later by the fetch-layer DNS guard)', () => {
    // This guard is structural only — it prevents authority confusion (userinfo,
    // path, whitespace). SSRF to private/loopback/metadata addresses is the
    // responsibility of validateUrlWithDNS / secureFetchWithValidation at fetch
    // time, the single SSRF chokepoint shared by tools, webhooks, and connectors.
    // These hosts are therefore structurally valid here, then blocked at fetch.
    expect(normalizeGitLabHost('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeGitLabHost('169.254.169.254')).toBe('169.254.169.254')
    expect(normalizeGitLabHost('localhost')).toBe('localhost')
  })
})

describe('getGitLabApiBase', () => {
  it('builds the v4 REST base for the default and self-managed hosts', () => {
    expect(getGitLabApiBase(undefined)).toBe('https://gitlab.com/api/v4')
    expect(getGitLabApiBase('gitlab.example.com')).toBe('https://gitlab.example.com/api/v4')
    expect(getGitLabApiBase('https://gitlab.example.com:8443/')).toBe(
      'https://gitlab.example.com:8443/api/v4'
    )
  })

  it('propagates rejection of unsafe hosts', () => {
    expect(() => getGitLabApiBase('legit.com@evil.com')).toThrow(UnsafeGitLabHostError)
  })
})
