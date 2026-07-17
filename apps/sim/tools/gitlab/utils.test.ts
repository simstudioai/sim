/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  coerceGitLabAccessLevel,
  getGitLabApiBase,
  getGitLabResourcePath,
  InvalidGitLabAccessLevelError,
  normalizeGitLabHost,
  UnsafeGitLabHostError,
} from '@/tools/gitlab/utils'

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

describe('getGitLabResourcePath', () => {
  it('builds project and group path segments', () => {
    expect(getGitLabResourcePath('project', 42)).toBe('projects/42')
    expect(getGitLabResourcePath('group', 7)).toBe('groups/7')
  })

  it('URL-encodes namespaced paths and trims whitespace', () => {
    expect(getGitLabResourcePath('project', '  mygroup/myproject  ')).toBe(
      'projects/mygroup%2Fmyproject'
    )
    expect(getGitLabResourcePath('group', 'parent/child')).toBe('groups/parent%2Fchild')
  })

  it('does not double-encode a resourceId that is already URL-encoded', () => {
    expect(getGitLabResourcePath('group', 'parent%2Fchild')).toBe('groups/parent%2Fchild')
    expect(getGitLabResourcePath('project', '  rvt-sandbox%2Fplatform-eng  ')).toBe(
      'projects/rvt-sandbox%2Fplatform-eng'
    )
  })

  it('treats a bare, non-percent-encoding "%" as a literal character', () => {
    expect(getGitLabResourcePath('group', '100%-done')).toBe('groups/100%25-done')
  })
})

describe('coerceGitLabAccessLevel', () => {
  it('accepts an integer already in the enum', () => {
    expect(coerceGitLabAccessLevel(0)).toBe(0)
    expect(coerceGitLabAccessLevel(30)).toBe(30)
    expect(coerceGitLabAccessLevel(50)).toBe(50)
  })

  it('accepts a numeric string', () => {
    expect(coerceGitLabAccessLevel('30')).toBe(30)
    expect(coerceGitLabAccessLevel('  40  ')).toBe(40)
  })

  it('accepts a level name, case-insensitively', () => {
    expect(coerceGitLabAccessLevel('Developer')).toBe(30)
    expect(coerceGitLabAccessLevel('developer')).toBe(30)
    expect(coerceGitLabAccessLevel('  MAINTAINER ')).toBe(40)
    expect(coerceGitLabAccessLevel('No access')).toBe(0)
    expect(coerceGitLabAccessLevel('Security Manager')).toBe(25)
  })

  it('throws for values outside the enum', () => {
    expect(() => coerceGitLabAccessLevel(999)).toThrow(InvalidGitLabAccessLevelError)
    expect(() => coerceGitLabAccessLevel(31)).toThrow(InvalidGitLabAccessLevelError)
    expect(() => coerceGitLabAccessLevel('root')).toThrow(InvalidGitLabAccessLevelError)
    expect(() => coerceGitLabAccessLevel('')).toThrow(InvalidGitLabAccessLevelError)
    expect(() => coerceGitLabAccessLevel('   ')).toThrow(InvalidGitLabAccessLevelError)
    expect(() => coerceGitLabAccessLevel(null)).toThrow(InvalidGitLabAccessLevelError)
    expect(() => coerceGitLabAccessLevel(undefined)).toThrow(InvalidGitLabAccessLevelError)
  })

  it('names the offending value and valid levels in the error message', () => {
    expect(() => coerceGitLabAccessLevel('boss')).toThrow(/Developer \(30\)/)
  })
})
