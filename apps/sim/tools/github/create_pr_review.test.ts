/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createPRReviewTool } from '@/tools/github/create_pr_review'

describe('createPRReviewTool request body', () => {
  const base = {
    owner: 'octo',
    repo: 'demo',
    pullNumber: 7,
    event: 'COMMENT' as const,
    apiKey: 'ghp_test',
  }

  it('includes comments and commit_id when provided', () => {
    const body = createPRReviewTool.request.body!({
      ...base,
      body: 'Looks good',
      commit_id: 'abc123',
      comments: [{ path: 'src/a.ts', body: 'nit', line: 3, side: 'RIGHT' }],
    })

    expect(body).toEqual({
      event: 'COMMENT',
      body: 'Looks good',
      commit_id: 'abc123',
      comments: [{ path: 'src/a.ts', body: 'nit', line: 3, side: 'RIGHT' }],
    })
  })

  it('parses comments from a JSON string', () => {
    const body = createPRReviewTool.request.body!({
      ...base,
      commit_id: 'abc123',
      comments: JSON.stringify([{ path: 'a.ts', body: 'fix me', line: 1 }]) as any,
    })

    expect(body.comments).toEqual([{ path: 'a.ts', body: 'fix me', line: 1 }])
  })

  it('requires commit_id when comments are present', () => {
    expect(() =>
      createPRReviewTool.request.body!({
        ...base,
        comments: [{ path: 'a.ts', body: 'x', line: 1 }],
      })
    ).toThrow(/commit_id is required/)
  })

  it('omits comments when none are provided', () => {
    const body = createPRReviewTool.request.body!({
      ...base,
      body: 'summary only',
    })

    expect(body).toEqual({ event: 'COMMENT', body: 'summary only' })
    expect(body.comments).toBeUndefined()
  })
})
