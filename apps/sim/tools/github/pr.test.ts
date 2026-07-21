/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { prTool, prV2Tool } from '@/tools/github/pr'
import type {
  CreateCommentParams,
  PROperationParams,
  PRV2OperationParams,
} from '@/tools/github/types'

type HasIncludeFiles<T> = 'includeFiles' extends keyof T ? true : false

const BASE_PARAMS = {
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
  apiKey: 'ghp_test',
} as const

function pullRequestPayload() {
  return {
    id: 1,
    number: 7,
    title: 'Review me',
    state: 'open',
    html_url: 'https://github.com/octo/demo/pull/7',
    diff_url: 'https://github.com/octo/demo/pull/7.diff',
    body: 'Description',
    user: {
      login: 'octo',
      id: 2,
      avatar_url: 'https://avatars.githubusercontent.com/u/2',
      html_url: 'https://github.com/octo',
      type: 'User',
    },
    head: { label: 'octo:feature', sha: 'a'.repeat(40), ref: 'feature' },
    base: { label: 'octo:staging', sha: 'b'.repeat(40), ref: 'staging' },
    merged: false,
    mergeable: true,
    merged_by: null,
    comments: 0,
    review_comments: 0,
    commits: 1,
    additions: 1,
    deletions: 1,
    changed_files: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    merged_at: null,
  }
}

function pullRequestResponse(): Response {
  return Response.json(pullRequestPayload())
}

function pullRequestFilePayload(index = 0) {
  return {
    sha: 'c'.repeat(40),
    filename: index === 0 ? 'src/index.ts' : `src/file-${index}.ts`,
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    blob_url: 'https://github.com/octo/demo/blob/abc/src/index.ts',
    raw_url: 'https://github.com/octo/demo/raw/abc/src/index.ts',
    contents_url: 'https://api.github.com/repos/octo/demo/contents/src/index.ts',
    patch: '@@ -1 +1,2 @@',
  }
}

describe('GitHub PR reader tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes includeFiles only on the V2 contract', () => {
    expect(prTool.params).not.toHaveProperty('includeFiles')
    expect(prV2Tool.params).toMatchObject({
      includeFiles: { type: 'boolean', required: false, default: true },
    })
    expectTypeOf<HasIncludeFiles<PROperationParams>>().toEqualTypeOf<false>()
    expectTypeOf<HasIncludeFiles<CreateCommentParams>>().toEqualTypeOf<false>()
    expectTypeOf<HasIncludeFiles<PRV2OperationParams>>().toEqualTypeOf<true>()
  })

  it('skips the files endpoint when includeFiles is false', async () => {
    const filesFetch = vi.fn()
    vi.stubGlobal('fetch', filesFetch)

    const result = await prV2Tool.transformResponse!(pullRequestResponse(), {
      ...BASE_PARAMS,
      includeFiles: false,
    })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      number: 7,
      head: { sha: 'a'.repeat(40) },
      base: { sha: 'b'.repeat(40), ref: 'staging' },
    })
    expect(result.output).not.toHaveProperty('files')
    expect(filesFetch).not.toHaveBeenCalled()
  })

  it('fetches and parses files when includeFiles is true or omitted', async () => {
    const filesFetch = vi.fn(() => Response.json([pullRequestFilePayload()]))
    vi.stubGlobal('fetch', filesFetch)

    const defaultResult = await prV2Tool.transformResponse!(pullRequestResponse(), BASE_PARAMS)
    const explicitResult = await prV2Tool.transformResponse!(pullRequestResponse(), {
      ...BASE_PARAMS,
      includeFiles: true,
    })

    expect(defaultResult.success).toBe(true)
    expect(explicitResult.success).toBe(true)
    expect(defaultResult.output.files).toEqual([pullRequestFilePayload()])
    expect(explicitResult.output.files).toEqual([pullRequestFilePayload()])
    expect(filesFetch).toHaveBeenCalledTimes(2)
    expect(filesFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/octo/demo/pulls/7/files?per_page=100&page=1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_test' }),
      })
    )
  })

  it('paginates changed files until GitHub returns a short page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => pullRequestFilePayload(index + 1))
    const finalFile = pullRequestFilePayload(101)
    const filesFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(Response.json([finalFile]))
    vi.stubGlobal('fetch', filesFetch)

    const result = await prV2Tool.transformResponse!(pullRequestResponse(), BASE_PARAMS)

    expect(result.success).toBe(true)
    expect(result.output.files).toHaveLength(101)
    expect(result.output.files?.at(-1)).toEqual(finalFile)
    expect(filesFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/octo/demo/pulls/7/files?per_page=100&page=2',
      expect.any(Object)
    )
  })

  it('preserves files endpoint failures when file fetching is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ message: 'secondary rate limit' }, { status: 403 }))
    )

    const result = await prV2Tool.transformResponse!(pullRequestResponse(), BASE_PARAMS)

    expect(result).toMatchObject({
      success: false,
      error: 'secondary rate limit',
      output: { number: 7 },
    })
    expect(result.output).not.toHaveProperty('files')
  })

  it('preserves the V1 files endpoint failure response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ message: 'files unavailable' }, { status: 503 }))
    )

    const result = await prTool.transformResponse!(pullRequestResponse(), BASE_PARAMS)

    expect(result).toMatchObject({
      success: false,
      error: 'files unavailable',
      output: {
        content: '',
        metadata: { number: 7, title: 'Review me', files: [] },
      },
    })
  })

  it('rejects malformed PR payloads instead of returning partial success', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const response = Response.json({ ...pullRequestPayload(), title: 42 })

    await expect(
      prV2Tool.transformResponse!(response, { ...BASE_PARAMS, includeFiles: false })
    ).rejects.toThrow('pull_request.title must be a string')
  })

  it('preserves primary pull request API failures', async () => {
    const response = Response.json({ message: 'pull request unavailable' }, { status: 503 })

    await expect(
      prV2Tool.transformResponse!(response, { ...BASE_PARAMS, includeFiles: false })
    ).rejects.toThrow('pull request unavailable')
  })

  it('rejects malformed successful files payloads instead of treating them as empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ files: [] }))
    )

    await expect(prV2Tool.transformResponse!(pullRequestResponse(), BASE_PARAMS)).rejects.toThrow(
      'GitHub pull request files response must be an array'
    )
  })
})
