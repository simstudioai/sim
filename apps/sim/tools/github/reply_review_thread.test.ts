/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { replyReviewThreadTool } from '@/tools/github/reply_review_thread'
import type { ReplyReviewThreadParams } from '@/tools/github/types'

const BASE_PARAMS: ReplyReviewThreadParams = {
  threadId: 'PRRT_1',
  body: 'Fixed in the follow-up commit.',
  apiKey: 'ghp_test',
}

describe('github_reply_review_thread', () => {
  it('addresses the reply by thread id, never by comment id', () => {
    const body = replyReviewThreadTool.request.body!(BASE_PARAMS) as {
      query: string
      variables: Record<string, unknown>
    }

    expect(body.query).toContain(
      'addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body })'
    )
    expect(body.variables).toEqual({
      threadId: 'PRRT_1',
      body: 'Fixed in the follow-up commit.',
    })
  })

  it('refuses an empty reply body', () => {
    expect(() => replyReviewThreadTool.request.body!({ ...BASE_PARAMS, body: '   ' })).toThrow(
      /body must not be empty/
    )
  })

  it('returns the created comment', async () => {
    const response = Response.json({
      data: {
        addPullRequestReviewThreadReply: {
          comment: {
            id: 'PRRC_9',
            url: 'https://github.com/octo/demo/pull/7#discussion_r9',
            createdAt: '2026-01-02T00:00:00Z',
          },
        },
      },
    })

    const result = await replyReviewThreadTool.transformResponse!(response, BASE_PARAMS)

    expect(result).toEqual({
      success: true,
      output: {
        id: 'PRRC_9',
        url: 'https://github.com/octo/demo/pull/7#discussion_r9',
        createdAt: '2026-01-02T00:00:00Z',
      },
    })
  })

  it('fails on a GraphQL error payload delivered with HTTP 200', async () => {
    const response = Response.json({
      data: { addPullRequestReviewThreadReply: null },
      errors: [{ message: 'Could not resolve to a node with the global id' }],
    })

    await expect(replyReviewThreadTool.transformResponse!(response, BASE_PARAMS)).rejects.toThrow(
      /Could not resolve to a node/
    )
  })
})
