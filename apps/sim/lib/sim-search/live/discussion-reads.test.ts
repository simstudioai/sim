import { describe, expect, it } from 'vitest'
import { readGitHub, searchGitHub } from '@/lib/sim-search/live/github'
import { readDrive } from '@/lib/sim-search/live/google'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { NativeClient } from '@/lib/sim-search/live/types'

const ISSUE = {
  number: 42,
  title: 'Roll out search',
  body: 'The original proposal',
  repository_url: 'https://api.github.com/repos/acme/search',
  html_url: 'https://github.com/acme/search/pull/42',
  pull_request: { url: 'https://api.github.com/repos/acme/search/pulls/42' },
  user: { login: 'author' },
}
const DRIVE_FILE = {
  id: 'doc',
  name: 'Launch plan',
  mimeType: 'application/vnd.google-apps.document',
  webViewLink: 'https://docs.google.com/document/d/doc/edit',
}
const text: NativeClient['text'] = async () => 'Original document text'
const bytes: NativeClient['bytes'] = async () => {
  throw new Error('Unexpected binary request')
}

/** Independent provider wire fixtures exercise pagination, partial failures, and rendering. */
describe('GitHub conversation reads', () => {
  it('keeps review decisions, diff context and discussion replies separate from the PR body', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json(path) {
        if (path.endsWith('/issues/42')) return ISSUE
        if (path.endsWith('/issues/42/comments'))
          return [
            {
              id: 1,
              body: 'Ship after migration',
              user: { login: 'alice' },
              created_at: '2026-09-01T12:00:00Z',
              html_url: `${ISSUE.html_url}#issuecomment-1`,
            },
          ]
        if (path.endsWith('/reviews'))
          return [
            {
              id: 2,
              state: 'CHANGES_REQUESTED',
              body: 'Fix the race',
              user: { login: 'bob' },
              submitted_at: '2026-09-02T12:00:00Z',
              html_url: `${ISSUE.html_url}#pullrequestreview-2`,
            },
            {
              id: 3,
              state: 'APPROVED',
              body: '',
              user: { login: 'carol' },
              submitted_at: '2026-09-03T12:00:00Z',
              html_url: `${ISSUE.html_url}#pullrequestreview-3`,
            },
            { id: 4, state: 'PENDING', body: 'Unsubmitted draft', user: { login: 'author' } },
          ]
        if (path.endsWith('/pulls/42/comments'))
          return [
            {
              id: 5,
              body: 'Use the lock here',
              user: { login: 'bob' },
              created_at: '2026-09-02T12:01:00Z',
              html_url: `${ISSUE.html_url}#discussion_r5`,
              path: 'src/search.ts',
              line: 17,
              side: 'RIGHT',
              pull_request_review_id: 2,
              in_reply_to_id: 4,
              diff_hunk: '@@ -1 +1 @@\n+await lock()',
            },
          ]
        throw new Error(`Unexpected endpoint: ${path}`)
      },
    }
    const { content } = await readGitHub(api, '42', 'acme/search', 'issues')
    for (const evidence of [
      'The original proposal',
      'Ship after migration',
      'alice',
      '2026-09-01T12:00:00Z',
      '#issuecomment-1',
      'CHANGES_REQUESTED',
      'APPROVED',
      'carol',
      'src/search.ts',
      '17',
      'RIGHT',
      '#discussion_r5',
      'Use the lock here',
      'await lock()',
      'Review: 2',
      'Reply to: 4',
    ])
      expect(content).toContain(evidence)
    expect(content).not.toContain('Unsubmitted draft')
  })

  it('exposes the matching comment passage in search even when the issue body is nonempty', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json() {
        return {
          total_count: 1,
          items: [
            {
              ...ISSUE,
              text_matches: [
                {
                  object_type: 'IssueComment',
                  property: 'body',
                  fragment: 'Use a lease for concurrency',
                },
              ],
            },
          ],
        }
      },
    }
    const result = await searchGitHub(api, {
      query: 'lease',
      native: {
        provider: 'github',
        kind: 'issues',
        query: 'repo:acme/search is:pr lease in:comments',
      },
      limit: 10,
      scopes: [],
    })
    expect(result.documents[0].content).toContain('Use a lease for concurrency')
  })

  it('reads subsequent comment pages and keeps the body when a different review endpoint is denied', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json(path, options) {
        if (path.endsWith('/issues/42')) return ISSUE
        if (path.endsWith('/issues/42/comments'))
          return options?.query?.page === '2'
            ? [{ id: 51, body: 'Second-page conclusion' }]
            : Array.from({ length: 50 }, (_, index) => ({ id: index + 1, body: 'Earlier comment' }))
        if (path.endsWith('/reviews'))
          throw new NativeSearchError('reconnect', 'Provider denied access')
        return []
      },
    }
    const { content } = await readGitHub(api, '42', 'acme/search', 'issues')
    expect(content).toContain('Second-page conclusion')
    expect(content).toContain('The original proposal')
    expect(content).toMatch(/incomplete[\s\S]*review/i)
  })

  it('marks a capped conversation incomplete and stops fetching a provider that always has another page', async () => {
    let requests = 0
    const api: NativeClient = {
      text,
      bytes,
      async json(path, options) {
        if (++requests > 11) throw new Error('Unbounded discussion pagination')
        if (path.endsWith('/issues/42')) return ISSUE
        return Array.from({ length: 50 }, (_, index) => ({
          id: `${options?.query?.page}-${index}`,
          body: 'A conversation entry',
          state: 'COMMENTED',
          submitted_at: '2026-09-01T00:00:00Z',
        }))
      },
    }
    const { content } = await readGitHub(api, '42', 'acme/search', 'issues')
    expect(content).toMatch(/incomplete/i)
    expect(content).toContain('A conversation entry')
    expect(requests).toBeLessThanOrEqual(10)
  })

  it('marks oversized discussion text incomplete instead of returning an unbounded transcript', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json(path) {
        if (path.endsWith('/issues/42')) return { ...ISSUE, pull_request: undefined }
        return [{ id: 1, body: 'x'.repeat(200_000) }]
      },
    }
    const { content } = await readGitHub(api, '42', 'acme/search', 'issues')
    expect(content).toMatch(/incomplete/i)
    expect(content.length).toBeLessThan(150_000)
    expect(content).toContain('The original proposal')
  })
})

describe('Drive discussion reads', () => {
  it('reads all comment pages with full nested replies, author/time context and resolution state', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json(path, options) {
        if (!path.endsWith('/comments')) return DRIVE_FILE
        if (options?.query?.pageToken === 'next')
          return { comments: [{ id: 'c2', content: 'Second-page decision', resolved: false }] }
        return {
          nextPageToken: 'next',
          comments: [
            {
              id: 'c1',
              content: 'Review this paragraph',
              author: { displayName: 'Alice' },
              createdTime: '2026-09-01T12:00:00Z',
              resolved: true,
              quotedFileContent: { value: 'Launch is next week' },
              replies: [
                {
                  id: 'r1',
                  content: 'Changed the launch date',
                  author: { displayName: 'Bob' },
                  createdTime: '2026-09-02T12:00:00Z',
                  action: 'resolve',
                },
                { id: 'r2', content: 'Deleted reply text', deleted: true },
              ],
            },
            { id: 'deleted', content: 'Deleted comment text', deleted: true },
          ],
        }
      },
    }
    const { content } = await readDrive(api, 'doc')
    for (const evidence of [
      'Original document text',
      'Review this paragraph',
      'Alice',
      '2026-09-01T12:00:00Z',
      'Launch is next week',
      'Changed the launch date',
      'Bob',
      'resolve',
      'Second-page decision',
      'c1',
      DRIVE_FILE.webViewLink,
    ])
      expect(content).toContain(evidence)
    expect(content).not.toContain('Deleted reply text')
    expect(content).not.toContain('Deleted comment text')
  })

  it('reports comments unavailable while preserving readable document content', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json(path) {
        if (path.endsWith('/comments'))
          throw new NativeSearchError('rate_limited', 'Provider rate limit reached')
        return DRIVE_FILE
      },
    }
    const { content } = await readDrive(api, 'doc')
    expect(content).toContain('Original document text')
    expect(content).toMatch(/incomplete[\s\S]*comment/i)
    expect(content).toMatch(/rate limit/i)
  })

  it('degrades a failed comment request to partial coverage', async () => {
    const api: NativeClient = {
      text,
      async json(path) {
        if (path.endsWith('/comments'))
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        return DRIVE_FILE
      },
    }
    const { content } = await readDrive(api, 'doc')
    expect(content).toContain('Original document text')
    expect(content).toMatch(/incomplete[\s\S]*could not be fully retrieved/i)
  })

  it('detects repeated comment cursors without silently claiming all comments were read', async () => {
    let pages = 0
    const api: NativeClient = {
      text,
      bytes,
      async json(path) {
        if (!path.endsWith('/comments')) return DRIVE_FILE
        if (++pages > 3) throw new Error('Unbounded Drive pagination')
        return {
          comments: [{ id: `c${pages}`, content: `Comment ${pages}` }],
          nextPageToken: 'same',
        }
      },
    }
    const { content } = await readDrive(api, 'doc')
    expect(content).toMatch(/incomplete/i)
    expect(content).toContain('Comment 1')
    expect(content).toContain('returned a repeated page cursor')
    expect(pages).toBe(2)
  })

  it('bounds nested reply content and explicitly marks what was omitted', async () => {
    const api: NativeClient = {
      text,
      bytes,
      async json(path) {
        if (!path.endsWith('/comments')) return DRIVE_FILE
        return {
          comments: [
            {
              id: 'c1',
              content: 'Opening comment',
              replies: [{ id: 'r1', content: 'x'.repeat(200_000) }],
            },
          ],
        }
      },
    }
    const { content } = await readDrive(api, 'doc')
    expect(content).toMatch(/incomplete/i)
    expect(content).toContain('Opening comment')
    expect(content.length).toBeLessThan(150_000)
  })
})
