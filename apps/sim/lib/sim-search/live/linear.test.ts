import { describe, expect, it } from 'vitest'
import { readLinear, searchLinear } from '@/lib/sim-search/live/linear'
import type { NativeClient, NativeSearchInput } from '@/lib/sim-search/live/types'

const ISSUE_ID = 'b2c74c54-a8cb-4b4a-96d9-5a386a7a5f25'
const PROJECT_ID = 'c9fb5f5c-5b3b-44b7-b978-37ead6a707cf'
const issue = {
  id: ISSUE_ID,
  identifier: 'ENG-42',
  title: 'Search rollout',
  description: 'Ship scoped retrieval.',
  url: 'https://linear.app/acme/issue/ENG-42/search-rollout',
  updatedAt: '2026-09-20T12:00:00Z',
  team: { id: 'team', name: 'Engineering' },
  state: { name: 'In progress' },
}
const input: NativeSearchInput = { query: 'rollout', limit: 10, scopes: [] }
function client(json: NativeClient['json']): NativeClient {
  return {
    json,
    bytes: async () => {
      throw new Error('Unexpected binary request')
    },
    text: async () => {
      throw new Error('Unexpected text request')
    },
  }
}

/** Failure modes: HTTP-200 errors, dropped filters, incomplete pagination, wrong identities, and omitted discussions. */
describe('Linear live search boundary', () => {
  it('drops provider citations on a nonstandard origin port', async () => {
    const api = client(async () => ({
      data: {
        searchIssues: {
          nodes: [{ ...issue, url: 'https://linear.app:444/acme/issue/ENG-42' }],
          pageInfo: { hasNextPage: false },
        },
      },
    }))
    expect(await searchLinear(api, input)).toMatchObject({ documents: [], partial: true })
  })

  it('bounds discussion text and puts the omission warning before the first read window', async () => {
    const api = client(async () => ({
      data: {
        issue: {
          ...issue,
          comments: {
            nodes: [{ id: 'large', body: 'x'.repeat(200_000) }],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    }))
    const document = await readLinear(api, ISSUE_ID)
    expect(document.content.length).toBeLessThan(130_000)
    expect(document.content.slice(0, 100)).toContain('incomplete')
    expect(document.content).toContain(issue.description)
  })

  it('preserves the readable issue when a later discussion page fails', async () => {
    const api = client(async (_path, options) => {
      const variables = (options?.body as { variables: Record<string, unknown> }).variables
      if (variables.after) return { errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }
      return {
        data: {
          issue: {
            ...issue,
            comments: {
              nodes: [{ id: 'first', body: 'Visible decision' }],
              pageInfo: { hasNextPage: true, endCursor: 'next' },
            },
          },
        },
      }
    })
    const document = await readLinear(api, ISSUE_ID)
    expect(document.content).toContain(issue.description)
    expect(document.content).toContain('Visible decision')
    expect(document.content.slice(0, 100)).toContain('incomplete')
  })

  it.each([
    ['RATELIMITED', 'rate_limited'],
    ['AUTHENTICATION_ERROR', 'reconnect'],
    ['FORBIDDEN', 'reconnect'],
    ['GRAPHQL_VALIDATION_FAILED', 'unavailable'],
  ])('does not turn GraphQL %s failures into empty successful results', async (code, status) => {
    const api = client(async () => ({
      errors: [{ message: 'private upstream detail', extensions: { code } }],
    }))
    await expect(searchLinear(api, input)).rejects.toMatchObject({ status })
  })

  it('pushes exact project/date filters and includes comment-only and archived matches without changing relevance ordering', async () => {
    let variables: Record<string, unknown> = {}
    const api = client(async (_path, options) => {
      variables = (options?.body as { variables: Record<string, unknown> }).variables
      return {
        data: {
          searchIssues: { nodes: [issue], pageInfo: { hasNextPage: true, endCursor: 'next' } },
        },
      }
    })
    const page = await searchLinear(api, {
      ...input,
      native: { provider: 'linear', query: 'rollout', project: PROJECT_ID, cursor: 'previous' },
      filters: { startDate: '2026-09-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z' },
    })
    expect(variables).toMatchObject({
      term: 'rollout',
      after: 'previous',
      includeComments: true,
      includeArchived: true,
      filter: {
        project: { id: { eq: PROJECT_ID } },
        updatedAt: { gte: '2026-09-01T00:00:00.000Z', lt: '2026-10-01T00:00:00.000Z' },
      },
    })
    expect(variables.orderBy).toBeUndefined()
    expect(page.nextCursor).toBe('next')
    expect(page.documents[0]).toMatchObject({
      id: ISSUE_ID,
      kind: 'issue',
      modifiedAt: issue.updatedAt,
    })
  })

  it('reports missing continuations instead of silently claiming complete coverage', async () => {
    const api = client(async () => ({
      data: { searchIssues: { nodes: [issue], pageInfo: { hasNextPage: true } } },
    }))
    expect(await searchLinear(api, input)).toMatchObject({ hasMore: true, partial: true })
  })

  it('rejects malformed search responses and project references', async () => {
    const api = client(async () => ({ data: { searchIssues: {} } }))
    await expect(searchLinear(api, input)).rejects.toThrow('unsupported')
    const ascending = client(async () => ({
      data: { searchIssues: { nodes: [issue], pageInfo: { hasNextPage: false } } },
    }))
    await expect(
      searchLinear(ascending, { ...input, filters: { sortBy: 'oldest' } })
    ).rejects.toThrow('unsupported')
    await expect(
      searchLinear(api, {
        ...input,
        native: { provider: 'linear', query: 'rollout', project: 'https://other.example/team' },
      })
    ).rejects.toThrow('project UUID')
  })

  it('reads subsequent comment pages with authors, reply context and direct citations', async () => {
    const api = client(async (_path, options) => {
      const variables = (options?.body as { variables: Record<string, unknown> }).variables
      return {
        data: {
          issue: {
            ...issue,
            comments: variables.after
              ? {
                  nodes: [
                    {
                      id: 'second',
                      body: 'Ship next week.',
                      user: { name: 'Lin' },
                      parent: { id: 'first' },
                      url: `${issue.url}#comment-second`,
                      createdAt: '2026-09-20T12:00:00Z',
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                }
              : {
                  nodes: [
                    {
                      id: 'first',
                      body: 'Please postpone.',
                      user: { name: 'Ada' },
                      url: `${issue.url}#comment-first`,
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor' },
                },
          },
        },
      }
    })
    const document = await readLinear(api, ISSUE_ID)
    expect(document.content).toContain('Please postpone.')
    expect(document.content).toContain('Ship next week.')
    expect(document.content).toContain('Lin')
    expect(document.content).toContain('Reply to first')
    expect(document.content).toContain('#comment-second')
  })

  it('does not return mismatched issue content under an old reference', async () => {
    const api = client(async () => ({
      data: {
        issue: {
          ...issue,
          id: 'different',
          comments: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      },
    }))
    await expect(readLinear(api, ISSUE_ID)).rejects.toThrow('identity')
  })
})
