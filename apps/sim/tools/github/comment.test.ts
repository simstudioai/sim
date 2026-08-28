/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commentTool, commentV2Tool } from '@/tools/github/comment'
import type { CreateCommentParams } from '@/tools/github/types'

const { secureGitHubRequest } = vi.hoisted(() => ({ secureGitHubRequest: vi.fn() }))

vi.mock('@/tools/github/utils.server', () => ({
  secureGitHubRequest,
  GITHUB_MAX_RESPONSE_BYTES: 10 * 1024 * 1024,
}))

const HEAD_SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)

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

interface RecordedCall {
  url: string
  method: string
  body: unknown
  signal: AbortSignal | undefined
}

function calls(): RecordedCall[] {
  return secureGitHubRequest.mock.calls.map(([url, options]) => ({
    url,
    method: options.method ?? 'GET',
    body: options.body === undefined ? undefined : JSON.parse(options.body),
    signal: options.signal,
  }))
}

describe('github_comment routing', () => {
  beforeEach(() => {
    secureGitHubRequest.mockReset()
  })

  it('posts to the reviews endpoint when commentType is unset', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())
    const params: CreateCommentParams = {
      owner: 'octo',
      repo: 'demo',
      pullNumber: 7,
      body: 'Nice',
      apiKey: 'ghp_test',
    }

    await commentTool.directExecution!(params)

    expect(calls()).toEqual([
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7/reviews',
        method: 'POST',
        body: { body: 'Nice', event: 'COMMENT' },
        signal: undefined,
      },
    ])
  })

  it('leaves a general PR comment on the reviews endpoint', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())

    await commentTool.directExecution!({
      owner: 'octo',
      repo: 'demo',
      pullNumber: 7,
      body: 'Nice',
      commentType: 'pr_comment',
      apiKey: 'ghp_test',
    })

    expect(calls()).toEqual([
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7/reviews',
        method: 'POST',
        body: { body: 'Nice', event: 'COMMENT' },
        signal: undefined,
      },
    ])
  })

  it('never looks the pull request up for a general PR comment carrying a path', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())

    await commentTool.directExecution!({
      owner: 'octo',
      repo: 'demo',
      pullNumber: 7,
      body: 'Nice',
      path: 'src/main.ts',
      commentType: 'pr_comment',
      apiKey: 'ghp_test',
    })

    expect(calls()).toEqual([
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7/comments',
        method: 'POST',
        body: { body: 'Nice', event: 'COMMENT' },
        signal: undefined,
      },
    ])
  })

  it('posts a file comment left without a path to the reviews endpoint', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())
    const { path, ...params } = FILE_COMMENT_PARAMS

    await commentTool.directExecution!(params)

    expect(calls()).toEqual([
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7/reviews',
        method: 'POST',
        body: { body: 'Looks good', line: 42, side: 'RIGHT' },
        signal: undefined,
      },
    ])
  })

  it('looks the pull request up and posts the resolved head SHA as commit_id', async () => {
    secureGitHubRequest
      .mockResolvedValueOnce(pullRequestResponse())
      .mockResolvedValueOnce(createdCommentResponse())

    const result = await commentTool.directExecution!(FILE_COMMENT_PARAMS)

    expect(calls()).toEqual([
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7',
        method: 'GET',
        body: undefined,
        signal: undefined,
      },
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7/comments',
        method: 'POST',
        body: {
          body: 'Looks good',
          commit_id: HEAD_SHA,
          path: 'src/main.ts',
          line: 42,
          side: 'RIGHT',
        },
        signal: undefined,
      },
    ])
    expect(result.output.metadata.commit_id).toBe(HEAD_SHA)
  })

  it('posts directly when commitId is supplied', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())

    await commentTool.directExecution!({ ...FILE_COMMENT_PARAMS, commitId: OTHER_SHA })

    expect(calls()).toEqual([
      {
        url: 'https://api.github.com/repos/octo/demo/pulls/7/comments',
        method: 'POST',
        body: {
          body: 'Looks good',
          commit_id: OTHER_SHA,
          path: 'src/main.ts',
          line: 42,
          side: 'RIGHT',
        },
        signal: undefined,
      },
    ])
  })

  it('resolves the head SHA for the v2 tool as well', async () => {
    secureGitHubRequest
      .mockResolvedValueOnce(pullRequestResponse())
      .mockResolvedValueOnce(createdCommentResponse())

    const result = await commentV2Tool.directExecution!(FILE_COMMENT_PARAMS)

    expect(calls()[1].body).toMatchObject({ commit_id: HEAD_SHA })
    expect(result.output.commit_id).toBe(HEAD_SHA)
  })

  it('no longer exposes the deprecated position parameter', () => {
    expect(commentTool.params.position).toBeUndefined()
  })

  it('keeps the declarative request in step with the executed routing', () => {
    const url = commentTool.request.url as (params: CreateCommentParams) => string
    const method = commentTool.request.method as (params: CreateCommentParams) => string

    expect(url(FILE_COMMENT_PARAMS)).toBe('https://api.github.com/repos/octo/demo/pulls/7')
    expect(method(FILE_COMMENT_PARAMS)).toBe('GET')
    expect(commentTool.request.body?.(FILE_COMMENT_PARAMS)).toBeUndefined()
  })
})

describe('github_comment cancellation', () => {
  beforeEach(() => {
    secureGitHubRequest.mockReset()
  })

  it('forwards the abort signal to both the lookup and the comment request', async () => {
    secureGitHubRequest
      .mockResolvedValueOnce(pullRequestResponse())
      .mockResolvedValueOnce(createdCommentResponse())
    const controller = new AbortController()

    await commentTool.directExecution!(FILE_COMMENT_PARAMS, controller.signal)

    const recorded = calls()
    expect(recorded).toHaveLength(2)
    expect(recorded[0].signal).toBe(controller.signal)
    expect(recorded[1].signal).toBe(controller.signal)
  })

  it('forwards the abort signal on the single-request path', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())
    const controller = new AbortController()

    await commentTool.directExecution!(
      { ...FILE_COMMENT_PARAMS, commitId: OTHER_SHA },
      controller.signal
    )

    expect(calls()[0].signal).toBe(controller.signal)
  })
})

describe('github_comment line coercion', () => {
  beforeEach(() => {
    secureGitHubRequest.mockReset()
  })

  it('coerces a line number typed into the short input to an integer', async () => {
    secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())

    await commentTool.directExecution!({
      ...FILE_COMMENT_PARAMS,
      commitId: OTHER_SHA,
      line: '42' as unknown as number,
    })

    expect(calls()[0].body).toMatchObject({ line: 42 })
  })

  it('coerces the line on the resolved-commit path as well', async () => {
    secureGitHubRequest
      .mockResolvedValueOnce(pullRequestResponse())
      .mockResolvedValueOnce(createdCommentResponse())

    await commentTool.directExecution!({
      ...FILE_COMMENT_PARAMS,
      line: '42' as unknown as number,
    })

    expect(calls()[1].body).toMatchObject({ line: 42 })
  })

  it('omits a blank or unparseable line rather than sending NaN', async () => {
    for (const line of ['', '   ', 'abc', undefined, null]) {
      secureGitHubRequest.mockReset()
      secureGitHubRequest.mockResolvedValueOnce(createdCommentResponse())

      await commentTool.directExecution!({
        ...FILE_COMMENT_PARAMS,
        commitId: OTHER_SHA,
        line: line as unknown as number,
      })

      expect(calls()[0].body).not.toHaveProperty('line')
    }
  })
})

describe('github_comment errors', () => {
  beforeEach(() => {
    secureGitHubRequest.mockReset()
  })

  it('fails with an actionable error when the pull request has no head SHA', async () => {
    secureGitHubRequest.mockResolvedValueOnce(Response.json({ number: 7 }))

    await expect(commentTool.directExecution!(FILE_COMMENT_PARAMS)).rejects.toThrow(
      /no head commit SHA for pull request octo\/demo#7/
    )
    expect(secureGitHubRequest).toHaveBeenCalledTimes(1)
  })

  it('surfaces the errors[] detail of a rejected comment', async () => {
    secureGitHubRequest.mockResolvedValueOnce(
      Response.json(
        {
          message: 'Validation Failed',
          errors: [{ field: 'line', code: 'invalid', message: 'line must be part of the diff' }],
        },
        { status: 422 }
      )
    )

    await expect(
      commentTool.directExecution!({ ...FILE_COMMENT_PARAMS, commitId: OTHER_SHA })
    ).rejects.toThrow('Validation Failed: line: line must be part of the diff')
  })

  it('carries the response status on a failed lookup', async () => {
    secureGitHubRequest.mockResolvedValueOnce(
      Response.json({ message: 'Not Found' }, { status: 404 })
    )

    await expect(commentTool.directExecution!(FILE_COMMENT_PARAMS)).rejects.toMatchObject({
      message: 'Not Found',
      status: 404,
    })
    expect(secureGitHubRequest).toHaveBeenCalledTimes(1)
  })
})
