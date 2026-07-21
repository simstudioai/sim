/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createPRReviewTool, createPRReviewV2Tool } from '@/tools/github/create_pr_review'

describe('createPRReviewTool request body', () => {
  const commitId = 'a'.repeat(40)
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
      commit_id: commitId,
      comments: [{ path: 'src/a.ts', body: 'nit', line: 3, side: 'RIGHT' }],
    })

    expect(body).toEqual({
      event: 'COMMENT',
      body: 'Looks good',
      commit_id: commitId,
      comments: [{ path: 'src/a.ts', body: 'nit', line: 3, side: 'RIGHT' }],
    })
  })

  it('requires commit_id when comments are present', () => {
    expect(() =>
      createPRReviewTool.request.body!({
        ...base,
        body: 'summary',
        comments: [{ path: 'a.ts', body: 'x', line: 1, side: 'RIGHT' }],
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

  it.each(['COMMENT', 'REQUEST_CHANGES'] as const)('requires a non-empty body for %s', (event) => {
    expect(() => createPRReviewTool.request.body!({ ...base, event, body: '   ' })).toThrow(
      /body is required/
    )
  })

  it('rejects invalid coordinates instead of forwarding them to GitHub', () => {
    expect(() =>
      createPRReviewTool.request.body!({
        ...base,
        body: 'summary',
        commit_id: 'abc123',
        comments: [{ path: 'a.ts', body: 'x', line: 1.5, side: 'RIGHT' }],
      })
    ).toThrow(/comments is invalid/)
  })

  it('rejects dynamic invalid events and malformed commit ids at the boundary', () => {
    expect(() =>
      createPRReviewTool.request.body!({ ...base, event: 'PENDING' as never, body: 'summary' })
    ).toThrow(/event must be/)
    expect(() =>
      createPRReviewTool.request.body!({
        ...base,
        body: 'summary',
        commit_id: '   ',
        comments: [{ path: 'a.ts', body: 'x', line: 1, side: 'RIGHT' }],
      })
    ).toThrow(/commit_id must be a full/)
  })
})

describe('createPRReviewV2Tool response', () => {
  function reviewPayload(overrides: Record<string, unknown> = {}) {
    return {
      id: 9,
      user: {
        login: 'octo',
        id: 1,
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        html_url: 'https://github.com/octo',
        type: 'User',
      },
      body: 'Review summary',
      state: 'COMMENTED',
      html_url: 'https://github.com/octo/demo/pull/7#pullrequestreview-9',
      pull_request_url: 'https://api.github.com/repos/octo/demo/pulls/7',
      commit_id: 'a'.repeat(40),
      submitted_at: '2026-07-20T00:00:00Z',
      ...overrides,
    }
  }

  it('preserves GitHub review nullability without inventing values', async () => {
    const payload = reviewPayload({ user: null, commit_id: null, submitted_at: undefined })

    const result = await createPRReviewV2Tool.transformResponse!(Response.json(payload))

    expect(result).toEqual({
      success: true,
      output: {
        id: 9,
        user: null,
        body: 'Review summary',
        state: 'COMMENTED',
        html_url: 'https://github.com/octo/demo/pull/7#pullrequestreview-9',
        pull_request_url: 'https://api.github.com/repos/octo/demo/pulls/7',
        commit_id: null,
      },
    })
  })

  it('rejects malformed successful review payloads', async () => {
    await expect(
      createPRReviewV2Tool.transformResponse!(Response.json(reviewPayload({ body: null })))
    ).rejects.toThrow('GitHub review response.body must be a string')
    await expect(
      createPRReviewV2Tool.transformResponse!(Response.json(reviewPayload({ html_url: '' })))
    ).rejects.toThrow('GitHub review response.html_url must be a non-empty string')
  })
})
