/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commentTool, commentV2Tool } from '@/tools/github/comment'
import type { CreateCommentParams } from '@/tools/github/types'

const HEAD_SHA = 'a'.repeat(40)

const FILE_COMMENT_PARAMS: CreateCommentParams = {
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
  body: 'Looks good',
  path: 'src/main.ts',
  line: 42,
  commentType: 'file_comment',
  apiKey: 'ghp_test',
}

function pullRequestResponse(): Response {
  return Response.json({ number: 7, head: { sha: HEAD_SHA, ref: 'feature' } })
}

function createdCommentResponse(): Response {
  return Response.json({
    id: 99,
    body: 'Looks good',
    html_url: 'https://github.com/octo/demo/pull/7#discussion_r99',
    path: 'src/main.ts',
    line: 42,
    side: 'RIGHT',
    commit_id: HEAD_SHA,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })
}

describe('github_comment file comments', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('looks the pull request up when no commitId is supplied', () => {
    const url = commentTool.request.url as (params: CreateCommentParams) => string
    const method = commentTool.request.method as (params: CreateCommentParams) => string

    expect(url(FILE_COMMENT_PARAMS)).toBe('https://api.github.com/repos/octo/demo/pulls/7')
    expect(method(FILE_COMMENT_PARAMS)).toBe('GET')
    expect(commentTool.request.body?.(FILE_COMMENT_PARAMS)).toBeUndefined()
  })

  it('posts the resolved head SHA as commit_id', async () => {
    fetchMock.mockResolvedValueOnce(createdCommentResponse())

    const result = await commentTool.transformResponse!(pullRequestResponse(), FILE_COMMENT_PARAMS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, init] = fetchMock.mock.calls[0]
    expect(requestUrl).toBe('https://api.github.com/repos/octo/demo/pulls/7/comments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      body: 'Looks good',
      commit_id: HEAD_SHA,
      path: 'src/main.ts',
      line: 42,
      side: 'RIGHT',
    })
    expect(result.success).toBe(true)
    expect(result.output.metadata.commit_id).toBe(HEAD_SHA)
  })

  it('resolves the head SHA for the v2 tool as well', async () => {
    fetchMock.mockResolvedValueOnce(createdCommentResponse())

    const result = await commentV2Tool.transformResponse!(
      pullRequestResponse(),
      FILE_COMMENT_PARAMS
    )

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).commit_id).toBe(HEAD_SHA)
    expect(result.output.commit_id).toBe(HEAD_SHA)
  })

  it('posts directly when commitId is supplied', () => {
    const params = { ...FILE_COMMENT_PARAMS, commitId: 'b'.repeat(40) }
    const url = commentTool.request.url as (params: CreateCommentParams) => string
    const method = commentTool.request.method as (params: CreateCommentParams) => string

    expect(url(params)).toBe('https://api.github.com/repos/octo/demo/pulls/7/comments')
    expect(method(params)).toBe('POST')
    expect(commentTool.request.body?.(params)).toEqual({
      body: 'Looks good',
      commit_id: 'b'.repeat(40),
      path: 'src/main.ts',
      line: 42,
      side: 'RIGHT',
    })
  })

  it('fails with an actionable error when the pull request has no head SHA', async () => {
    await expect(
      commentTool.transformResponse!(Response.json({ number: 7 }), FILE_COMMENT_PARAMS)
    ).rejects.toThrow(/no head commit SHA for pull request octo\/demo#7/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves general PR comments on the reviews endpoint', () => {
    const params: CreateCommentParams = {
      owner: 'octo',
      repo: 'demo',
      pullNumber: 7,
      body: 'Nice',
      commentType: 'pr_comment',
      apiKey: 'ghp_test',
    }
    const url = commentTool.request.url as (params: CreateCommentParams) => string

    expect(url(params)).toBe('https://api.github.com/repos/octo/demo/pulls/7/reviews')
    expect(commentTool.request.body?.(params)).toEqual({ body: 'Nice', event: 'COMMENT' })
  })

  it('no longer exposes the deprecated position parameter', () => {
    expect(commentTool.params.position).toBeUndefined()
  })

  it('leaves an untouched block on the reviews endpoint when commentType is unset', () => {
    const params: CreateCommentParams = {
      owner: 'octo',
      repo: 'demo',
      pullNumber: 7,
      body: 'Nice',
      apiKey: 'ghp_test',
    }
    const url = commentTool.request.url as (params: CreateCommentParams) => string
    const method = commentTool.request.method as (params: CreateCommentParams) => string

    expect(url(params)).toBe('https://api.github.com/repos/octo/demo/pulls/7/reviews')
    expect(method(params)).toBe('POST')
    expect(commentTool.request.body?.(params)).toEqual({ body: 'Nice', event: 'COMMENT' })
  })

  it('never looks the pull request up for a general PR comment carrying a path', () => {
    const params: CreateCommentParams = {
      owner: 'octo',
      repo: 'demo',
      pullNumber: 7,
      body: 'Nice',
      path: 'src/main.ts',
      commentType: 'pr_comment',
      apiKey: 'ghp_test',
    }
    const url = commentTool.request.url as (params: CreateCommentParams) => string
    const method = commentTool.request.method as (params: CreateCommentParams) => string

    expect(url(params)).toBe('https://api.github.com/repos/octo/demo/pulls/7/comments')
    expect(method(params)).toBe('POST')
    expect(commentTool.request.body?.(params)).toEqual({ body: 'Nice', event: 'COMMENT' })
  })

  it('posts a file comment left without a path to the reviews endpoint', () => {
    const { path, ...params } = FILE_COMMENT_PARAMS
    const url = commentTool.request.url as (params: CreateCommentParams) => string
    const method = commentTool.request.method as (params: CreateCommentParams) => string

    expect(url(params)).toBe('https://api.github.com/repos/octo/demo/pulls/7/reviews')
    expect(method(params)).toBe('POST')
  })

  it('does not fetch the pull request for a file comment left without a path', async () => {
    const { path, ...params } = FILE_COMMENT_PARAMS

    const result = await commentTool.transformResponse!(createdCommentResponse(), params)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
  })

  it('coerces a line number typed into the short input to an integer', () => {
    const params = {
      ...FILE_COMMENT_PARAMS,
      commitId: 'b'.repeat(40),
      line: '42' as unknown as number,
    }

    expect(commentTool.request.body?.(params)).toEqual({
      body: 'Looks good',
      commit_id: 'b'.repeat(40),
      path: 'src/main.ts',
      line: 42,
      side: 'RIGHT',
    })
  })

  it('coerces the line on the resolved-commit path as well', async () => {
    fetchMock.mockResolvedValueOnce(createdCommentResponse())
    const params = { ...FILE_COMMENT_PARAMS, line: '42' as unknown as number }

    await commentTool.transformResponse!(pullRequestResponse(), params)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).line).toBe(42)
  })

  it('omits a blank or unparseable line rather than sending NaN', () => {
    for (const line of ['', '   ', 'abc', undefined, null]) {
      const params = {
        ...FILE_COMMENT_PARAMS,
        commitId: 'b'.repeat(40),
        line: line as unknown as number,
      }
      const body = commentTool.request.body?.(params) as Record<string, unknown>

      expect(body).toHaveProperty('line')
      expect(body.line).toBeUndefined()
    }
  })
})
