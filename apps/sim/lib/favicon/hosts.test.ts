import { describe, expect, it } from 'vitest'
import { faviconHostCandidates } from '@/lib/favicon/hosts'

describe('faviconHostCandidates', () => {
  it.each([
    'localhost',
    'intranet',
    'wiki.local',
    'build.internal',
    'printer.lan',
    'jira.corp',
    'docs.example',
    'nas.home.arpa',
    '10.0.0.7',
    '[::1]',
    '192.168.1.20:8080',
  ])('never offers internal host %s to a provider', (host) => {
    expect(faviconHostCandidates(host)).toEqual([])
  })

  it('walks a private tenant up to its platform', () => {
    expect(faviconHostCandidates('zq7tenant.atlassian.net')).toEqual([
      'zq7tenant.atlassian.net',
      'atlassian.net',
    ])
  })

  it('treats a private public suffix as the platform, never the bare TLD', () => {
    expect(faviconHostCandidates('docs.zq7tenant.gitlab.io')).toEqual([
      'docs.zq7tenant.gitlab.io',
      'zq7tenant.gitlab.io',
      'gitlab.io',
    ])
  })

  it('stops at the registrable domain under a multi-label public suffix', () => {
    expect(faviconHostCandidates('intranet.example.co.uk')).toEqual([
      'intranet.example.co.uk',
      'example.co.uk',
    ])
  })

  it('tries at most three parents', () => {
    expect(faviconHostCandidates('a.b.c.d.e.example.com')).toEqual([
      'a.b.c.d.e.example.com',
      'b.c.d.e.example.com',
      'c.d.e.example.com',
      'd.e.example.com',
    ])
  })

  it('normalizes case, a trailing dot, and a port', () => {
    expect(faviconHostCandidates('Docs.Example.COM.:443')).toEqual([
      'docs.example.com',
      'example.com',
    ])
  })

  it('looks up an internationalized host by its ASCII form', () => {
    expect(faviconHostCandidates('bücher.de')).toEqual(['xn--bcher-kva.de'])
  })

  it.each(['', 'https://example.com/path', 'exa mple.com', 'user@example.com', 'com'])(
    'offers nothing for %j',
    (host) => {
      expect(faviconHostCandidates(host)).toEqual([])
    }
  )
})
