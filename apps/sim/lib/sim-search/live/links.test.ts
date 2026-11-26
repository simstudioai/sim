/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { locateDocumentLink, parseDocumentLinks } from '@/lib/sim-search/live/links'
import type { NativeClient } from '@/lib/sim-search/live/types'

describe('parseDocumentLinks', () => {
  it.each([
    [
      'a Google Doc opened from a second signed-in account',
      'https://docs.google.com/document/u/1/d/1AbcDEFghijKLmn/edit#heading=h.x',
      {
        provider: 'google_drive',
        reference: { id: '1AbcDEFghijKLmn', kind: 'application/vnd.google-apps.document' },
      },
    ],
    [
      'a Drive file',
      'https://drive.google.com/file/d/1AbcDEFghijKLmn/view?usp=sharing',
      { provider: 'google_drive', reference: { id: '1AbcDEFghijKLmn' } },
    ],
    [
      'the Gmail link a search result cites',
      'https://mail.google.com/mail/u/0/#all/18c0ffee12345678',
      { provider: 'gmail', reference: { id: '18c0ffee12345678' } },
    ],
    [
      'a Calendar event on a gmail.com calendar',
      `https://www.google.com/calendar/event?eid=${Buffer.from('evt_20260101 jane@m').toString('base64url')}`,
      {
        provider: 'google_calendar',
        reference: { id: 'evt_20260101', container: 'jane@gmail.com' },
      },
    ],
    [
      'a Slack thread reply',
      'https://acme.slack.com/archives/C0123ABC/p1700000000123456?thread_ts=1699999999.000100&cid=C0123ABC',
      {
        provider: 'slack',
        reference: {
          id: '1700000000.123456',
          container: 'C0123ABC',
          threadId: '1699999999.000100',
        },
      },
    ],
    [
      'a Slack canvas',
      'https://acme.slack.com/docs/T0123/F0456CANVAS',
      { provider: 'slack', reference: { id: 'F0456CANVAS', kind: 'file' } },
    ],
    [
      'a pull request tab',
      'https://github.com/acme/api/pull/42/files',
      { provider: 'github', reference: { container: 'acme/api', id: '42', kind: 'issues' } },
    ],
    [
      'a commit within a pull request',
      'https://github.com/acme/api/pull/42/commits/abc1234',
      { provider: 'github', reference: { container: 'acme/api', id: 'abc1234', kind: 'commits' } },
    ],
    [
      'a file, whose branch and path the repository tells apart',
      'https://github.com/acme/api/blob/release/2026/src/index.ts#L10',
      {
        provider: 'github',
        repository: 'acme/api',
        blob: ['release', '2026', 'src', 'index.ts'],
      },
    ],
    [
      'a repository clone URL',
      'https://github.com/acme/api.git',
      {
        provider: 'github',
        reference: { container: 'acme/api', id: 'acme/api', kind: 'repositories' },
      },
    ],
    [
      'a Linear issue',
      'https://linear.app/Acme/issue/eng-12/fix-login',
      { provider: 'linear', workspace: 'acme', issueKey: 'ENG-12' },
    ],
    [
      'a Notion page',
      'https://www.notion.so/acme/Roadmap-0123456789abcdef0123456789abcdef',
      {
        provider: 'notion',
        reference: { id: '01234567-89ab-cdef-0123-456789abcdef', kind: 'mcp' },
      },
    ],
    [
      'a Fireflies meeting with its title',
      'https://app.fireflies.ai/view/Weekly-sync::01M4BH6WW1J5XC9A1HX83DGGQN',
      { provider: 'fireflies', reference: { id: '01M4BH6WW1J5XC9A1HX83DGGQN', kind: 'meeting' } },
    ],
  ])('reads %s as the reference its reader takes', (_case, link, expected) => {
    expect(parseDocumentLinks(link)).toEqual([expected])
  })

  it.each([
    [
      'a Jira issue selected on a board',
      'https://acme.atlassian.net/jira/software/projects/ENG/boards/1?selectedIssue=ENG-7',
      [{ provider: 'jira', host: 'acme.atlassian.net', reference: { id: 'ENG-7' } }],
    ],
    [
      'a dated Confluence blog post',
      'https://acme.atlassian.net/wiki/spaces/ENG/blog/2026/01/31/98765/Launch',
      [
        {
          provider: 'confluence',
          host: 'acme.atlassian.net',
          reference: { id: '98765', kind: 'blogpost' },
        },
      ],
    ],
    [
      'a Confluence space overview',
      'https://acme.atlassian.net/wiki/spaces/ENG/overview',
      [
        {
          provider: 'confluence',
          host: 'acme.atlassian.net',
          reference: { id: 'ENG', kind: 'space' },
        },
      ],
    ],
    [
      'a merge request on a self-hosted GitLab in a subgroup',
      'https://git.acme.dev/platform/infra/api/-/merge_requests/9/diffs',
      [
        {
          provider: 'gitlab',
          host: 'git.acme.dev',
          reference: { container: 'platform/infra/api', id: '9', kind: 'merge_requests' },
        },
      ],
    ],
  ])('reads %s on any host, for the account on that host', (_case, link, expected) => {
    expect(parseDocumentLinks(link)).toEqual(expected)
  })

  it('leaves values that are not web links to the document ID path', () => {
    expect(parseDocumentLinks('live2:google_drive~account~doc~abc123')).toBeUndefined()
  })

  it.each([
    ['a plain-HTTP link', 'http://docs.google.com/document/d/1AbcDEFghijKLmn/edit'],
    ['a link carrying credentials', 'https://user:pass@acme.atlassian.net/browse/ENG-1'],
    ['a published copy of a Doc', 'https://docs.google.com/document/d/e/2PACX-1vQabcdefghij/pub'],
    ['a Slack channel', 'https://acme.slack.com/archives/C0123ABC'],
    ['a GitHub site page', 'https://github.com/orgs/acme/projects'],
    [
      'a Gmail conversation without a message ID',
      'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJ',
    ],
    ['an unrelated site', 'https://example.com/about'],
  ])('names nothing for %s', (_case, link) => {
    expect(parseDocumentLinks(link)).toEqual([])
  })
})

describe('locateDocumentLink', () => {
  const client = (response: unknown): NativeClient => ({
    json: vi.fn(async () => response),
    text: vi.fn(),
    bytes: vi.fn(),
  })

  it('places an Atlassian link only on the grant’s site served at its host', async () => {
    const [link] = parseDocumentLinks('https://b.atlassian.net/browse/ENG-7') ?? []
    if (!link) throw new Error('Expected a link')
    const sites = [
      { id: 'cloud-a', url: 'https://a.atlassian.net' },
      { id: 'cloud-b', url: 'https://B.atlassian.net' },
    ]
    const origin = 'https://api.atlassian.com'
    await expect(locateDocumentLink(link, { client: client(sites), origin })).resolves.toEqual({
      id: 'ENG-7',
      container: 'cloud-b',
    })
    await expect(
      locateDocumentLink(link, { client: client(sites.slice(0, 1)), origin })
    ).resolves.toBeUndefined()
  })

  it('places a GitLab link only on the account’s own host', async () => {
    const [link] = parseDocumentLinks('https://git.acme.dev/team/api/-/issues/3') ?? []
    if (!link) throw new Error('Expected a link')
    await expect(
      locateDocumentLink(link, { client: null, origin: 'https://gitlab.com' })
    ).resolves.toBeUndefined()
    await expect(
      locateDocumentLink(link, { client: null, origin: 'https://git.acme.dev' })
    ).resolves.toEqual({ container: 'team/api', id: '3', kind: 'issues' })
  })

  it('reads a file link on the default branch, whose name may hold slashes, and only there', async () => {
    const [link] =
      parseDocumentLinks('https://github.com/acme/api/blob/release/2026/src/a.ts') ?? []
    if (!link) throw new Error('Expected a link')
    const origin = 'https://api.github.com'
    const repository = (branch: string) => client({ full_name: 'Acme/api', default_branch: branch })
    await expect(
      locateDocumentLink(link, { client: repository('release/2026'), origin })
    ).resolves.toEqual({ id: 'src/a.ts', container: 'Acme/api', kind: 'code' })
    await expect(locateDocumentLink(link, { client: repository('main'), origin })).rejects.toThrow(
      'default branch (main)'
    )
  })

  it('names the branch of a GitLab file link, as a GitLab source pins one', async () => {
    const [link] = parseDocumentLinks('https://git.acme.dev/team/api/-/blob/main/src/a.ts') ?? []
    if (!link) throw new Error('Expected a link')
    await expect(
      locateDocumentLink(link, {
        client: client({ id: 42, default_branch: 'main' }),
        origin: 'https://git.acme.dev',
      })
    ).resolves.toEqual({ id: 'src/a.ts', container: '42', kind: 'code', revision: 'main' })
  })

  it('refuses a Linear key that names an issue in another workspace', async () => {
    const [link] = parseDocumentLinks('https://linear.app/acme/issue/ENG-12') ?? []
    if (!link) throw new Error('Expected a link')
    const issue = (workspace: string) => ({
      data: {
        issue: {
          id: '00000000-0000-4000-8000-000000000001',
          url: `https://linear.app/${workspace}/issue/ENG-12/title`,
          team: { id: 'team' },
        },
      },
    })
    const origin = 'https://api.linear.app'
    await expect(
      locateDocumentLink(link, { client: client(issue('other')), origin })
    ).resolves.toBeUndefined()
    await expect(
      locateDocumentLink(link, { client: client(issue('acme')), origin })
    ).resolves.toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'issue',
      container: 'team',
    })
  })
})
