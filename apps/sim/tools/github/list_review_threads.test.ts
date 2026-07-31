/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { listReviewThreadsTool } from '@/tools/github/list_review_threads'
import type { ListReviewThreadsParams } from '@/tools/github/types'

const BASE_PARAMS: ListReviewThreadsParams = {
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
  apiKey: 'ghp_test',
}

function threadsPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'PRRT_1',
                isResolved: false,
                path: 'src/index.ts',
                line: 12,
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      body: 'This leaks a handle.',
                      authorAssociation: 'MEMBER',
                      author: { login: 'greptile', __typename: 'Bot' },
                    },
                  ],
                },
              },
            ],
            ...overrides,
          },
          reviews: { nodes: [] },
        },
      },
    },
  }
}

function requestBody(params: ListReviewThreadsParams) {
  const body = listReviewThreadsTool.request.body!(params) as {
    query: string
    variables: Record<string, unknown>
  }
  return body
}

describe('github_list_review_threads', () => {
  it('asks for the pull request, page size, and cursor it was given', () => {
    const body = requestBody({
      ...BASE_PARAMS,
      threadsPerPage: 25,
      commentsPerThread: 10,
      cursor: 'CURSOR_1',
    })

    expect(body.query).toContain('reviewThreads(first: $threads, after: $cursor)')
    expect(body.query).toContain('authorAssociation')
    expect(body.query).toContain('author { login __typename }')
    expect(body.variables).toEqual({
      owner: 'octo',
      repo: 'demo',
      number: 7,
      threads: 25,
      comments: 10,
      cursor: 'CURSOR_1',
    })
  })

  it('defaults both page sizes and sends a null cursor for the first page', () => {
    expect(requestBody(BASE_PARAMS).variables).toMatchObject({
      threads: 50,
      comments: 50,
      cursor: null,
    })
  })

  it('rejects a page size GitHub would refuse', () => {
    expect(() => requestBody({ ...BASE_PARAMS, threadsPerPage: 101 })).toThrow(
      /threadsPerPage must be an integer between 1 and 100/
    )
    expect(() => requestBody({ ...BASE_PARAMS, commentsPerThread: 0 })).toThrow(
      /commentsPerThread must be an integer between 1 and 100/
    )
  })

  it('parses threads, their comments, and the page cursor', async () => {
    const result = await listReviewThreadsTool.transformResponse!(
      Response.json(threadsPayload({ pageInfo: { hasNextPage: true, endCursor: 'CURSOR_2' } })),
      BASE_PARAMS
    )

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      totalCount: 1,
      hasNextPage: true,
      endCursor: 'CURSOR_2',
      latestReview: null,
    })
    expect(result.output.threads).toEqual([
      {
        id: 'PRRT_1',
        isResolved: false,
        path: 'src/index.ts',
        line: 12,
        commentsTotalCount: 1,
        comments: [
          {
            body: 'This leaks a handle.',
            authorAssociation: 'MEMBER',
            authorLogin: 'greptile',
            authorType: 'Bot',
          },
        ],
      },
    ])
  })

  it('keeps the truncation signal: totalCount can exceed the fetched comments', async () => {
    const payload = threadsPayload()
    payload.data.repository.pullRequest.reviewThreads.nodes[0].comments.totalCount = 80

    const result = await listReviewThreadsTool.transformResponse!(
      Response.json(payload),
      BASE_PARAMS
    )

    expect(result.output.threads[0].commentsTotalCount).toBe(80)
    expect(result.output.threads[0].comments).toHaveLength(1)
  })

  it('reads a null line and a deleted comment author as null rather than failing', async () => {
    const payload = threadsPayload()
    payload.data.repository.pullRequest.reviewThreads.nodes[0].line = null
    payload.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].author = null

    const result = await listReviewThreadsTool.transformResponse!(
      Response.json(payload),
      BASE_PARAMS
    )

    expect(result.output.threads[0].line).toBeNull()
    expect(result.output.threads[0].comments[0]).toMatchObject({
      authorLogin: null,
      authorType: null,
    })
  })

  it('returns the newest submitted review with its author type', async () => {
    const payload = threadsPayload()
    payload.data.repository.pullRequest.reviews = {
      nodes: [
        {
          state: 'COMMENTED',
          submittedAt: '2026-01-02T00:00:00Z',
          author: { login: 'greptile', __typename: 'Bot' },
        },
      ],
    }

    const result = await listReviewThreadsTool.transformResponse!(
      Response.json(payload),
      BASE_PARAMS
    )

    expect(result.output.latestReview).toEqual({
      state: 'COMMENTED',
      submittedAt: '2026-01-02T00:00:00Z',
      authorLogin: 'greptile',
      authorType: 'Bot',
    })
  })

  it('fails on a GraphQL error payload delivered with HTTP 200', async () => {
    const response = Response.json({
      data: { repository: null },
      errors: [{ message: 'Resource not accessible by integration' }],
    })

    await expect(listReviewThreadsTool.transformResponse!(response, BASE_PARAMS)).rejects.toThrow(
      /Resource not accessible by integration/
    )
  })

  it('fails rather than reporting zero threads when the pull request is missing', async () => {
    const response = Response.json({ data: { repository: { pullRequest: null } } })

    await expect(listReviewThreadsTool.transformResponse!(response, BASE_PARAMS)).rejects.toThrow(
      /pullRequest was not found/
    )
  })
})
