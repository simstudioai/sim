/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { describeSearchSource, searchSourceIdentity } from '@/lib/sim-search/source-identity'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'

describe('Search source identity', () => {
  it('normalizes multi-value settings and ignores runtime mappings and cleared caps', () => {
    expect(
      searchSourceIdentity(confluenceConnectorMeta, {
        domain: ' acme.atlassian.net ',
        spaceKey: 'ENG, OPS,ENG',
        maxPages: '10',
      })
    ).toBe(
      searchSourceIdentity(confluenceConnectorMeta, {
        spaceKey: ['OPS', 'ENG'],
        domain: 'acme.atlassian.net',
        maxPages: 0,
        tagSlotMapping: { title: 'tag1' },
      })
    )
  })

  it('keeps separate sites, source filters, GitLab hosts and repositories distinct', () => {
    const confluence = { domain: 'one.atlassian.net', spaceKey: 'ENG' }
    for (const change of [
      { domain: 'two.atlassian.net' },
      { spaceKey: 'OPS' },
      { labelFilter: 'public' },
    ]) {
      expect(searchSourceIdentity(confluenceConnectorMeta, confluence)).not.toBe(
        searchSourceIdentity(confluenceConnectorMeta, { ...confluence, ...change })
      )
    }
    const gitlab = { host: 'gitlab.one.example', project: 'group/repo', ref: 'main' }
    for (const change of [
      { host: 'gitlab.two.example' },
      { project: 'group/other' },
      { ref: 'release' },
    ]) {
      expect(searchSourceIdentity(gitlabConnectorMeta, gitlab)).not.toBe(
        searchSourceIdentity(gitlabConnectorMeta, { ...gitlab, ...change })
      )
    }
  })

  it('describes declared source addresses without exposing credentials or arbitrary config', () => {
    expect(
      describeSearchSource(gitlabConnectorMeta, {
        host: 'gitlab.one.example',
        project: 'group/repo',
        apiKey: 'secret',
        encryptedApiKey: 'ciphertext',
        arbitrary: 'private value',
        issueLabels: 'confidential filter',
      })
    ).toBe('gitlab.one.example · group/repo')
    expect(
      describeSearchSource(confluenceConnectorMeta, { domain: 'x'.repeat(500) }).length
    ).toBeLessThanOrEqual(240)
  })
})
