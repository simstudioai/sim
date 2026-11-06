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

  it.each([
    ['portal.awsapps.com', ['portal.awsapps.com', 'awsapps.com', 'aws.amazon.com']],
    ['acme.coupahost.com', ['acme.coupahost.com', 'coupahost.com', 'coupa.com']],
    [
      'docs.acme.gitlab-dedicated.site',
      [
        'docs.acme.gitlab-dedicated.site',
        'acme.gitlab-dedicated.site',
        'gitlab-dedicated.site',
        'gitlab.com',
      ],
    ],
    [
      'acme.gitlab-dedicated.com',
      ['acme.gitlab-dedicated.com', 'gitlab-dedicated.com', 'gitlab.com'],
    ],
    ['acme.testrail.io', ['acme.testrail.io', 'testrail.io', 'testrail.com']],
    [
      'acme.databricksapps.mil',
      ['acme.databricksapps.mil', 'databricksapps.mil', 'databricks.com'],
    ],
    [
      'dbc-1.cloud.databricks.us',
      ['dbc-1.cloud.databricks.us', 'cloud.databricks.us', 'databricks.us', 'databricks.com'],
    ],
  ])(
    'ends a platform tenant %s at the platform, after its own host and parents',
    (host, expected) => {
      expect(faviconHostCandidates(host)).toEqual(expected)
    }
  )

  it.each([
    ['gitlab.acme-internal.io', 'gitlab.com'],
    ['jira.acme-internal.io', 'atlassian.com'],
    ['testrail.qa.acme-internal.io', 'testrail.com'],
  ])('ends a self-hosted %s at its product', (host, product) => {
    expect(faviconHostCandidates(host).at(-1)).toBe(product)
  })

  it.each([
    'mygitlab.acme-internal.io',
    'docs.gitlab.acme-internal.io',
    'notawsapps.com',
    'acme.herokuapp.com',
    'gitlab.azurewebsites.net',
    'gitlab.acme.vercel.app',
  ])('adds no platform for %s, which only resembles one', (host) => {
    const candidates = faviconHostCandidates(host)
    expect(candidates).not.toContain('gitlab.com')
    expect(candidates).not.toContain('aws.amazon.com')
    expect(candidates.length).toBeGreaterThan(0)
  })

  it.each(['gitlab.corp', 'gitlab', 'jira.local'])(
    'still offers nothing for internal %s',
    (host) => {
      expect(faviconHostCandidates(host)).toEqual([])
    }
  )

  it('adds nothing for a platform whose parent the walk already reaches', () => {
    expect(faviconHostCandidates('acme.my.salesforce.com')).toEqual([
      'acme.my.salesforce.com',
      'my.salesforce.com',
      'salesforce.com',
    ])
  })

  it('never repeats a host the walk already reaches', () => {
    expect(faviconHostCandidates('gitlab.gitlab.com')).toEqual(['gitlab.gitlab.com', 'gitlab.com'])
  })

  it('tries at most three parents, always ending at the registrable domain', () => {
    expect(faviconHostCandidates('a.b.c.d.e.example.com')).toEqual([
      'a.b.c.d.e.example.com',
      'b.c.d.e.example.com',
      'c.d.e.example.com',
      'example.com',
    ])
    expect(faviconHostCandidates('a.b.c.d.example.co.uk')).toEqual([
      'a.b.c.d.example.co.uk',
      'b.c.d.example.co.uk',
      'c.d.example.co.uk',
      'example.co.uk',
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

  it.each(['x.com&size=1.com', 'a&b=c.com', 'a%26b.com', "it's.com", 'a(b).com', 'a+b.com'])(
    'offers nothing for %j, whose punctuation would reshape a provider URL',
    (host) => {
      expect(faviconHostCandidates(host)).toEqual([])
    }
  )

  it.each(['example.com..', '.example.com', 'docs..example.com'])(
    'offers nothing for %j, which has an empty label',
    (host) => {
      expect(faviconHostCandidates(host)).toEqual([])
    }
  )

  it('keeps an underscore, which some real hosts use', () => {
    expect(faviconHostCandidates('my_app.example.com')).toEqual([
      'my_app.example.com',
      'example.com',
    ])
  })

  it.each(['', 'https://example.com/path', 'exa mple.com', 'user@example.com', 'com'])(
    'offers nothing for %j',
    (host) => {
      expect(faviconHostCandidates(host)).toEqual([])
    }
  )
})
