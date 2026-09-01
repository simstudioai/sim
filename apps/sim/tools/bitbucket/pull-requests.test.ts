/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeBitbucketGetPullRequestDiffOperation } from '@/lib/internal/bitbucket/operations/get-pull-request-diff'
import { executeBitbucketGetPullRequestDiffstatOperation } from '@/lib/internal/bitbucket/operations/get-pull-request-diffstat'
import { bitbucketApprovePullRequestTool } from '@/tools/bitbucket/approve_pull_request'
import { bitbucketCreatePullRequestTool } from '@/tools/bitbucket/create_pull_request'
import { bitbucketCreatePullRequestCommentTool } from '@/tools/bitbucket/create_pull_request_comment'
import { bitbucketDeclinePullRequestTool } from '@/tools/bitbucket/decline_pull_request'
import { bitbucketGetMergeTaskStatusTool } from '@/tools/bitbucket/get_merge_task_status'
import { bitbucketGetPullRequestTool } from '@/tools/bitbucket/get_pull_request'
import { bitbucketListPullRequestCommentsTool } from '@/tools/bitbucket/list_pull_request_comments'
import { bitbucketListPullRequestCommitStatusesTool } from '@/tools/bitbucket/list_pull_request_commit_statuses'
import { bitbucketListPullRequestsTool } from '@/tools/bitbucket/list_pull_requests'
import { bitbucketMergePullRequestTool } from '@/tools/bitbucket/merge_pull_request'
import { bitbucketRequestPullRequestChangesTool } from '@/tools/bitbucket/request_pull_request_changes'
import type {
  BitbucketCreatePullRequestCommentParams,
  BitbucketCreatePullRequestParams,
  BitbucketGetMergeTaskStatusParams,
  BitbucketGetPullRequestDiffParams,
  BitbucketListPullRequestCommentsParams,
  BitbucketListPullRequestCommitStatusesParams,
  BitbucketListPullRequestsParams,
  BitbucketMergePullRequestParams,
  BitbucketPaginatedPullRequestParams,
} from '@/tools/bitbucket/types'
import { assertBitbucketResponseOk } from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

const serverMocks = vi.hoisted(() => ({
  resolveBitbucketPullRequestRedirect: vi.fn(),
  secureBitbucketRead: vi.fn(),
  secureBitbucketPullRequestRedirect: vi.fn(),
}))

vi.mock('@/tools/bitbucket/utils.server', () => serverMocks)

const PULL_REQUEST_PARAMS = {
  accessToken: 'oauth-token',
  workspaceSlug: 'acme team',
  repoSlug: 'sdk/core',
  prId: 7,
} as const

const RAW_USER = {
  uuid: '{user-1}',
  account_id: 'account-1',
  type: 'user',
  display_name: 'Ada Lovelace',
  created_on: '2026-01-01T00:00:00Z',
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/users/ada' },
    html: { href: 'https://bitbucket.org/ada' },
    avatar: { href: 'https://avatar.test/ada' },
  },
}

const RAW_PARTICIPANT = {
  type: 'participant',
  user: RAW_USER,
  role: 'REVIEWER',
  approved: true,
  state: 'approved',
  participated_on: '2026-01-02T00:00:00Z',
}

const RAW_PULL_REQUEST = {
  type: 'pullrequest',
  id: 7,
  title: 'Ship the SDK',
  description: 'Top-level description',
  rendered: { description: { raw: 'Rendered fallback' } },
  summary: { raw: 'Summary fallback' },
  state: 'OPEN',
  draft: false,
  queued: false,
  author: RAW_USER,
  closed_by: null,
  source: {
    branch: { name: 'feature/sdk' },
    commit: { hash: 'source123' },
    repository: { uuid: '{repo-1}', full_name: 'acme/demo' },
  },
  destination: {
    branch: { name: 'main' },
    commit: { hash: 'main123' },
    repository: { uuid: '{repo-1}', full_name: 'acme/demo' },
  },
  merge_commit: null,
  comment_count: 3,
  task_count: 1,
  close_source_branch: true,
  reason: null,
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-02T00:00:00Z',
  reviewers: [RAW_USER],
  participants: [RAW_PARTICIPANT],
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests/7' },
    html: { href: 'https://bitbucket.org/acme/demo/pull-requests/7' },
  },
}

const RAW_COMMENT = {
  type: 'pullrequest_comment',
  id: 10,
  created_on: '2026-01-02T00:00:00Z',
  updated_on: '2026-01-03T00:00:00Z',
  content: { raw: 'Looks good' },
  user: RAW_USER,
  deleted: false,
  parent: { id: 9 },
  inline: { path: 'src/index.ts', from: 4, to: 5, start_from: 2, start_to: 3 },
  pending: false,
  resolution: { user: RAW_USER, created_on: '2026-01-04T00:00:00Z' },
  links: {
    self: { href: 'https://api.bitbucket.org/comment/10' },
    html: { href: 'https://bitbucket.org/comment/10' },
  },
}

const RAW_COMMIT_STATUS = {
  type: 'build',
  key: 'ci/test',
  refname: 'feature/sdk',
  url: 'https://ci.example.test/build/1',
  state: 'SUCCESSFUL',
  name: 'CI',
  description: 'All checks passed',
  created_on: '2026-01-02T00:00:00Z',
  updated_on: '2026-01-03T00:00:00Z',
  links: {
    self: { href: 'https://api.bitbucket.org/status/1' },
    commit: { href: 'https://api.bitbucket.org/commit/source123' },
  },
}

const RAW_DIFFSTAT = {
  type: 'diffstat',
  status: 'modified',
  lines_added: 12,
  lines_removed: 4,
  old: { path: 'src/old.ts', commit: { hash: 'main123' } },
  new: { path: 'src/new.ts', commit: { hash: 'source123' } },
}

function requestUrl<P, R>(tool: ToolConfig<P, R>, params: P): string {
  return typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
}

function requestBody<P, R>(tool: ToolConfig<P, R>, params: P): unknown {
  return tool.request.body?.(params)
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('Bitbucket pull request request builders', () => {
  it('builds list and detail URLs with encoded coordinates and filters', () => {
    const list = new URL(
      requestUrl(bitbucketListPullRequestsTool, {
        ...PULL_REQUEST_PARAMS,
        state: 'OPEN',
        q: 'draft = false',
        sort: '-updated_on',
        pageLen: 25,
      } satisfies BitbucketListPullRequestsParams)
    )
    expect(list.pathname).toBe('/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests')
    expect(Object.fromEntries(list.searchParams)).toEqual({
      state: 'OPEN',
      q: 'draft = false',
      sort: '-updated_on',
      pagelen: '25',
    })
    expect(requestUrl(bitbucketGetPullRequestTool, PULL_REQUEST_PARAMS)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7'
    )
    expect(() =>
      requestUrl(bitbucketListPullRequestsTool, {
        ...PULL_REQUEST_PARAMS,
        state: 'CLOSED',
      } as unknown as BitbucketListPullRequestsParams)
    ).toThrow(/state must be one of/)
    expect(() =>
      requestUrl(bitbucketListPullRequestsTool, {
        ...PULL_REQUEST_PARAMS,
        q: false,
      } as unknown as BitbucketListPullRequestsParams)
    ).toThrow(/q must be a non-empty string/)
  })

  it('builds the complete documented create-pull-request body', () => {
    const params = {
      ...PULL_REQUEST_PARAMS,
      title: ' Ship the SDK ',
      sourceBranch: ' feature/sdk ',
      destinationBranch: ' main ',
      description: 'Ready for review',
      closeSourceBranch: false,
      draft: true,
      reviewerUuids: [' {reviewer-1} ', '{reviewer-2}'],
    } satisfies BitbucketCreatePullRequestParams

    expect(requestBody(bitbucketCreatePullRequestTool, params)).toEqual({
      title: 'Ship the SDK',
      source: { branch: { name: 'feature/sdk' } },
      destination: { branch: { name: 'main' } },
      description: 'Ready for review',
      close_source_branch: false,
      draft: true,
      reviewers: [{ uuid: '{reviewer-1}' }, { uuid: '{reviewer-2}' }],
    })
    expect(() =>
      requestBody(bitbucketCreatePullRequestTool, {
        ...params,
        reviewerUuids: ['  '],
      })
    ).toThrow(/reviewer UUID must be a non-empty string/)
    expect(() =>
      requestBody(bitbucketCreatePullRequestTool, {
        ...params,
        closeSourceBranch: 'false',
      } as unknown as BitbucketCreatePullRequestParams)
    ).toThrow(/closeSourceBranch must be a boolean/)
    expect(() =>
      requestBody(bitbucketCreatePullRequestTool, {
        ...params,
        draft: 0,
      } as unknown as BitbucketCreatePullRequestParams)
    ).toThrow(/draft must be a boolean/)
    expect(() =>
      requestBody(bitbucketCreatePullRequestTool, {
        ...params,
        reviewerUuids: ['{reviewer-1}', true],
      } as unknown as BitbucketCreatePullRequestParams)
    ).toThrow(/reviewer UUID must be a non-empty string/)
    expect(() =>
      requestBody(bitbucketCreatePullRequestTool, {
        ...params,
        reviewerUuids: '{reviewer-1}',
      } as unknown as BitbucketCreatePullRequestParams)
    ).toThrow(/reviewerUuids must be an array of strings/)
  })

  it('builds every pull request action endpoint', () => {
    expect(requestUrl(bitbucketDeclinePullRequestTool, PULL_REQUEST_PARAMS)).toMatch(
      /\/pullrequests\/7\/decline$/
    )
    expect(requestUrl(bitbucketApprovePullRequestTool, PULL_REQUEST_PARAMS)).toMatch(
      /\/pullrequests\/7\/approve$/
    )
    expect(requestUrl(bitbucketRequestPullRequestChangesTool, PULL_REQUEST_PARAMS)).toMatch(
      /\/pullrequests\/7\/request-changes$/
    )
    expect(
      requestUrl(bitbucketGetMergeTaskStatusTool, {
        ...PULL_REQUEST_PARAMS,
        taskId: 'task/with ?#',
      } satisfies BitbucketGetMergeTaskStatusParams)
    ).toMatch(/\/merge\/task-status\/task%2Fwith%20%3F%23$/)
  })

  it('builds comment and status pagination plus the reply body', () => {
    const comments = new URL(
      requestUrl(bitbucketListPullRequestCommentsTool, {
        ...PULL_REQUEST_PARAMS,
        q: 'deleted = false',
        sort: '-created_on',
        pageLen: 50,
      } satisfies BitbucketListPullRequestCommentsParams)
    )
    expect(comments.pathname).toMatch(/\/pullrequests\/7\/comments$/)
    expect(Object.fromEntries(comments.searchParams)).toEqual({
      q: 'deleted = false',
      sort: '-created_on',
      pagelen: '50',
    })

    const statuses = new URL(
      requestUrl(bitbucketListPullRequestCommitStatusesTool, {
        ...PULL_REQUEST_PARAMS,
        q: 'state = "FAILED"',
        sort: '-created_on',
        pageLen: 10,
      } satisfies BitbucketListPullRequestCommitStatusesParams)
    )
    expect(statuses.pathname).toMatch(/\/pullrequests\/7\/statuses$/)
    expect(Object.fromEntries(statuses.searchParams)).toEqual({
      q: 'state = "FAILED"',
      sort: '-created_on',
      pagelen: '10',
    })

    const commentParams = {
      ...PULL_REQUEST_PARAMS,
      content: 'Please add a regression test.',
      parentId: 9,
    } satisfies BitbucketCreatePullRequestCommentParams
    expect(requestBody(bitbucketCreatePullRequestCommentTool, commentParams)).toEqual({
      content: { raw: 'Please add a regression test.' },
      parent: { id: 9 },
    })
    expect(() =>
      requestBody(bitbucketCreatePullRequestCommentTool, { ...commentParams, content: '  ' })
    ).toThrow(/content must be a non-empty string/)
    expect(() =>
      requestBody(bitbucketCreatePullRequestCommentTool, { ...commentParams, parentId: 0 })
    ).toThrow(/parentId must be a positive integer/)
    expect(() =>
      requestBody(bitbucketCreatePullRequestCommentTool, {
        ...commentParams,
        parentId: true,
      } as unknown as BitbucketCreatePullRequestCommentParams)
    ).toThrow(/parentId must be a positive integer/)
  })
})

describe('Bitbucket pull request response normalization', () => {
  it('normalizes list, get, create, decline, and synchronous merge responses consistently', async () => {
    const listed = await bitbucketListPullRequestsTool.transformResponse!(
      Response.json({ values: [RAW_PULL_REQUEST], size: 1, page: 1, pagelen: 20 })
    )
    const fetched = await bitbucketGetPullRequestTool.transformResponse!(
      Response.json(RAW_PULL_REQUEST)
    )
    const created = await bitbucketCreatePullRequestTool.transformResponse!(
      Response.json(RAW_PULL_REQUEST)
    )
    const declined = await bitbucketDeclinePullRequestTool.transformResponse!(
      Response.json(RAW_PULL_REQUEST)
    )
    const merged = await bitbucketMergePullRequestTool.transformResponse!(
      Response.json({ ...RAW_PULL_REQUEST, state: 'MERGED' }),
      PULL_REQUEST_PARAMS
    )

    expect(listed.output.items[0]).toMatchObject({
      id: 7,
      description: 'Top-level description',
      source: {
        branchName: 'feature/sdk',
        commitHash: 'source123',
        repositoryUuid: '{repo-1}',
        repositoryFullName: 'acme/demo',
      },
      reviewers: [{ accountId: 'account-1' }],
      participants: [{ approved: true, user: { accountId: 'account-1' } }],
    })
    expect(fetched.output.pullRequest).toEqual(listed.output.items[0])
    expect(created.output.pullRequest).toEqual(listed.output.items[0])
    expect(declined.output.pullRequest).toEqual(listed.output.items[0])
    expect(merged.output).toMatchObject({
      status: 'completed',
      taskId: null,
      taskUrl: null,
      pullRequest: { state: 'MERGED' },
    })
  })

  it('preserves null reviewers and participants when Bitbucket omits those expansions', async () => {
    const result = await bitbucketGetPullRequestTool.transformResponse!(
      Response.json({ ...RAW_PULL_REQUEST, reviewers: undefined, participants: undefined })
    )
    expect(result.output.pullRequest).toMatchObject({ reviewers: null, participants: null })
  })

  it('normalizes approval and change-request participants', async () => {
    const approved = await bitbucketApprovePullRequestTool.transformResponse!(
      Response.json(RAW_PARTICIPANT)
    )
    const changes = await bitbucketRequestPullRequestChangesTool.transformResponse!(
      Response.json({ ...RAW_PARTICIPANT, approved: false, state: 'changes_requested' })
    )
    expect(approved.output.participant).toMatchObject({
      role: 'REVIEWER',
      approved: true,
      user: { uuid: '{user-1}', accountId: 'account-1' },
    })
    expect(changes.output.participant).toMatchObject({
      approved: false,
      state: 'changes_requested',
    })
  })

  it('normalizes comments, replies, inline coordinates, resolutions, and statuses', async () => {
    const comments = await bitbucketListPullRequestCommentsTool.transformResponse!(
      Response.json({ values: [RAW_COMMENT] })
    )
    const created = await bitbucketCreatePullRequestCommentTool.transformResponse!(
      Response.json(RAW_COMMENT)
    )
    expect(comments.output.items[0]).toMatchObject({
      id: 10,
      content: 'Looks good',
      parentId: 9,
      inline: { path: 'src/index.ts', from: 4, to: 5, startFrom: 2, startTo: 3 },
      resolution: { resolver: { accountId: 'account-1' }, resolvedOn: '2026-01-04T00:00:00Z' },
    })
    expect(created.output.comment).toEqual(comments.output.items[0])

    const statuses = await bitbucketListPullRequestCommitStatusesTool.transformResponse!(
      Response.json({ values: [RAW_COMMIT_STATUS] })
    )
    expect(statuses.output.items[0]).toEqual({
      type: 'build',
      key: 'ci/test',
      refName: 'feature/sdk',
      url: 'https://ci.example.test/build/1',
      state: 'SUCCESSFUL',
      name: 'CI',
      description: 'All checks passed',
      createdOn: '2026-01-02T00:00:00Z',
      updatedOn: '2026-01-03T00:00:00Z',
      selfUrl: 'https://api.bitbucket.org/status/1',
      commitUrl: 'https://api.bitbucket.org/commit/source123',
    })
  })

  it('rejects resources missing required type and commit-status invariants', async () => {
    await expect(
      bitbucketGetPullRequestTool.transformResponse!(
        Response.json({ ...RAW_PULL_REQUEST, type: undefined })
      )
    ).rejects.toThrow(/pull request\.type must be a non-empty string/)

    await expect(
      bitbucketListPullRequestCommitStatusesTool.transformResponse!(
        Response.json({ values: [{ ...RAW_COMMIT_STATUS, type: undefined }] })
      )
    ).rejects.toThrow(/commit status\.type must be a non-empty string/)

    const partial = await bitbucketListPullRequestCommitStatusesTool.transformResponse!(
      Response.json({
        values: [{ ...RAW_COMMIT_STATUS, key: undefined, state: undefined }, RAW_COMMIT_STATUS],
      })
    )
    expect(partial.output.items).toHaveLength(2)
    expect(partial.output.items[0]).toMatchObject({ key: null, state: null })
  })
})

describe('Bitbucket merge lifecycle', () => {
  it('sends optional merge fields and forces asynchronous task creation support', () => {
    const params = {
      ...PULL_REQUEST_PARAMS,
      mergeStrategy: 'squash_fast_forward',
      message: 'Ship it',
      closeSourceBranch: false,
    } satisfies BitbucketMergePullRequestParams
    expect(requestUrl(bitbucketMergePullRequestTool, params)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7/merge?async=true'
    )
    expect(requestBody(bitbucketMergePullRequestTool, params)).toEqual({
      type: 'pullrequest',
      merge_strategy: 'squash_fast_forward',
      message: 'Ship it',
      close_source_branch: false,
    })

    expect(() =>
      requestBody(bitbucketMergePullRequestTool, {
        ...params,
        mergeStrategy: 'octopus',
      } as unknown as BitbucketMergePullRequestParams)
    ).toThrow(/mergeStrategy must be one of/)
    expect(() =>
      requestBody(bitbucketMergePullRequestTool, {
        ...params,
        closeSourceBranch: 'false',
      } as unknown as BitbucketMergePullRequestParams)
    ).toThrow(/closeSourceBranch must be a boolean/)
    expect(() =>
      requestBody(bitbucketMergePullRequestTool, {
        ...params,
        message: 'é'.repeat(65_537),
      })
    ).toThrow(/message must not exceed 131072 UTF-8 bytes/)
  })

  it('returns a validated task for a 202 merge response', async () => {
    const response = new Response(null, {
      status: 202,
      headers: {
        Location:
          'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7/merge/task-status/task%20one',
      },
    })
    const result = await bitbucketMergePullRequestTool.transformResponse!(
      response,
      PULL_REQUEST_PARAMS
    )
    expect(result).toEqual({
      success: true,
      output: {
        status: 'pending',
        taskId: 'task one',
        taskUrl:
          'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7/merge/task-status/task%20one',
        pullRequest: null,
      },
    })
  })

  it('accepts a canonical-cased merge task Location for a mixed-case slug', async () => {
    const result = await bitbucketMergePullRequestTool.transformResponse!(
      new Response(null, {
        status: 202,
        headers: {
          Location:
            'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7/merge/task-status/task-1',
        },
      }),
      { ...PULL_REQUEST_PARAMS, workspaceSlug: 'ACME Team', repoSlug: 'SDK/Core' }
    )
    expect(result.output).toMatchObject({ status: 'pending', taskId: 'task-1' })
  })

  it('rejects missing, cross-origin, and wrong-pull-request task Locations', async () => {
    await expect(
      bitbucketMergePullRequestTool.transformResponse!(
        new Response(null, { status: 202 }),
        PULL_REQUEST_PARAMS
      )
    ).rejects.toThrow(/omitted the Location/)
    await expect(
      bitbucketMergePullRequestTool.transformResponse!(
        new Response(null, {
          status: 202,
          headers: { Location: 'https://evil.test/task/1' },
        }),
        PULL_REQUEST_PARAMS
      )
    ).rejects.toThrow(/Bitbucket Cloud API 2.0 URL/)
    await expect(
      bitbucketMergePullRequestTool.transformResponse!(
        new Response(null, {
          status: 202,
          headers: {
            Location:
              'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/8/merge/task-status/task-1',
          },
        }),
        PULL_REQUEST_PARAMS
      )
    ).rejects.toThrow(/did not match the requested pull request/)
  })

  it('normalizes pending and successful task-status responses', async () => {
    const pending = await bitbucketGetMergeTaskStatusTool.transformResponse!(
      Response.json({
        task_status: 'PENDING',
        links: { self: { href: 'https://api.bitbucket.org/task/task-1' } },
      })
    )
    expect(pending.output).toEqual({
      taskStatus: 'PENDING',
      selfUrl: 'https://api.bitbucket.org/task/task-1',
      mergeResult: null,
    })

    const success = await bitbucketGetMergeTaskStatusTool.transformResponse!(
      Response.json({
        task_status: 'SUCCESS',
        merge_result: { ...RAW_PULL_REQUEST, state: 'MERGED' },
      })
    )
    expect(success.output).toMatchObject({
      taskStatus: 'SUCCESS',
      mergeResult: { id: 7, state: 'MERGED' },
    })
  })

  it('rejects merge-task errors, unknown statuses, and missing success results', async () => {
    await expect(
      bitbucketGetMergeTaskStatusTool.transformResponse!(
        Response.json({
          type: 'error',
          error: { message: 'The destination changed while the merge was queued' },
        })
      )
    ).rejects.toThrow('The destination changed while the merge was queued')
    await expect(
      bitbucketGetMergeTaskStatusTool.transformResponse!(Response.json({ task_status: 'FAILED' }))
    ).rejects.toThrow(/must be PENDING or SUCCESS/)
    await expect(
      bitbucketGetMergeTaskStatusTool.transformResponse!(Response.json({ task_status: 'SUCCESS' }))
    ).rejects.toThrow(/omitted merge_result/)
    await expect(
      bitbucketGetMergeTaskStatusTool.transformResponse!(
        Response.json({ task_status: 'PENDING', merge_result: RAW_PULL_REQUEST })
      )
    ).resolves.toMatchObject({
      output: { taskStatus: 'PENDING', mergeResult: null },
    })
  })

  it('surfaces merge conflicts and failed merge checks from structured Bitbucket errors', async () => {
    await expect(
      assertBitbucketResponseOk(
        Response.json(
          { error: { message: 'Merge conflict: destination changed' } },
          { status: 409 }
        )
      )
    ).rejects.toThrow('Merge conflict: destination changed')
    await expect(
      assertBitbucketResponseOk(
        Response.json(
          { error: { message: 'Required merge checks have not passed' } },
          { status: 409 }
        )
      )
    ).rejects.toThrow('Required merge checks have not passed')
  })
})

describe('Bitbucket pull request diff safety', () => {
  it('requires a file path and applies it only to the validated repository diff target', async () => {
    serverMocks.secureBitbucketPullRequestRedirect.mockResolvedValueOnce(
      new Response('@@ -1 +1 @@\n-old\n+new\n', {
        headers: { 'Content-Length': '24', 'Content-Type': 'text/plain' },
      })
    )
    const params = {
      ...PULL_REQUEST_PARAMS,
      path: '/src/my file.ts/',
      maxCharacters: 100,
    } satisfies BitbucketGetPullRequestDiffParams

    const result = await executeBitbucketGetPullRequestDiffOperation(params)

    expect(result).toMatchObject({
      success: true,
      output: {
        diff: '@@ -1 +1 @@\n-old\n+new\n',
        decodingLossy: false,
        truncated: false,
      },
    })
    expect(serverMocks.secureBitbucketPullRequestRedirect).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7/diff',
      'acme team',
      'sdk/core',
      'diff',
      expect.objectContaining({
        Accept: '*/*',
        Authorization: 'Bearer oauth-token',
        Range: 'bytes=0-399',
      }),
      10 * 1024 * 1024,
      { signal: undefined, targetQuery: { path: 'src/my file.ts', binary: 'false' } }
    )
  })

  it('rejects hostile repository-relative paths before making a redirect request', async () => {
    await expect(
      executeBitbucketGetPullRequestDiffOperation({
        ...PULL_REQUEST_PARAMS,
        path: '../secret',
      })
    ).rejects.toThrow(/dot segment/)
    expect(serverMocks.secureBitbucketPullRequestRedirect).not.toHaveBeenCalled()
  })

  it('locally caps raw diff text when a Range response is ignored', async () => {
    serverMocks.secureBitbucketPullRequestRedirect.mockResolvedValueOnce(
      new Response('0123456789', { headers: { 'Content-Length': '10' } })
    )
    const result = await executeBitbucketGetPullRequestDiffOperation({
      ...PULL_REQUEST_PARAMS,
      path: 'src/index.ts',
      maxCharacters: 4,
    })
    expect(result.output).toEqual({
      diff: '0123',
      decodingLossy: false,
      truncated: true,
      returnedBytes: 10,
      fullBytes: 10,
    })
  })

  it('lossily decodes invalid UTF-8 only for pull request diffs', async () => {
    serverMocks.secureBitbucketPullRequestRedirect.mockResolvedValueOnce(
      new Response(new Uint8Array([0x41, 0x80]), {
        headers: { 'Content-Length': '2', 'Content-Type': 'text/plain' },
      })
    )
    const result = await executeBitbucketGetPullRequestDiffOperation({
      ...PULL_REQUEST_PARAMS,
      path: 'src/index.ts',
      maxCharacters: 100,
    })

    expect(result.output).toEqual({
      diff: 'A�',
      decodingLossy: true,
      truncated: false,
      returnedBytes: 2,
      fullBytes: 2,
    })
  })

  it('uses the PR redirect only for the first diffstat page and puts pagelen on the target', async () => {
    serverMocks.secureBitbucketPullRequestRedirect.mockResolvedValueOnce(
      Response.json({ values: [RAW_DIFFSTAT] })
    )
    const params = {
      ...PULL_REQUEST_PARAMS,
      pageLen: 25,
    } satisfies BitbucketPaginatedPullRequestParams

    const result = await executeBitbucketGetPullRequestDiffstatOperation(params)

    expect(result.output.items[0]).toEqual({
      type: 'diffstat',
      status: 'modified',
      linesAdded: 12,
      linesRemoved: 4,
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
      oldCommitHash: 'main123',
      newCommitHash: 'source123',
    })
    expect(serverMocks.secureBitbucketPullRequestRedirect).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pullrequests/7/diffstat',
      'acme team',
      'sdk/core',
      'diffstat',
      expect.objectContaining({ Authorization: 'Bearer oauth-token' }),
      2 * 1024 * 1024,
      { signal: undefined, targetQuery: { pagelen: '25' } }
    )
    expect(serverMocks.secureBitbucketRead).not.toHaveBeenCalled()
  })

  it('fetches an already-validated repository diffstat cursor directly', async () => {
    const nextUrl =
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/diffstat/source-team/source-repo:6315b3bac849%0Decdc2efc4f27?page=2'
    serverMocks.resolveBitbucketPullRequestRedirect.mockResolvedValueOnce(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/diffstat/source-team/source-repo:6315b3bac849%0Decdc2efc4f27'
    )
    serverMocks.secureBitbucketRead.mockResolvedValueOnce(
      Response.json({ values: [RAW_DIFFSTAT], page: 2 })
    )

    const result = await executeBitbucketGetPullRequestDiffstatOperation({
      ...PULL_REQUEST_PARAMS,
      nextUrl,
      pageLen: 99,
    })

    expect(result.output.page.page).toBe(2)
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledWith(
      nextUrl,
      expect.objectContaining({ Authorization: 'Bearer oauth-token' }),
      2 * 1024 * 1024,
      { maxRedirects: 0, signal: undefined }
    )
    expect(serverMocks.secureBitbucketPullRequestRedirect).not.toHaveBeenCalled()
  })

  it('rejects a diffstat cursor for a different pull request revspec', async () => {
    serverMocks.resolveBitbucketPullRequestRedirect.mockResolvedValueOnce(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/diffstat/source-team/source-repo:6315b3bac849%0Decdc2efc4f27'
    )

    await expect(
      executeBitbucketGetPullRequestDiffstatOperation({
        ...PULL_REQUEST_PARAMS,
        nextUrl:
          'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/diffstat/source-team/source-repo:6315b3bac849%0Dunrelated?page=2',
      })
    ).rejects.toThrow(/does not belong to this Bitbucket pull request diffstat/)
    expect(serverMocks.secureBitbucketRead).not.toHaveBeenCalled()
  })

  it('rejects hostile or cross-repository diffstat cursors before fetching', async () => {
    const invalid = [
      'https://evil.test/2.0/repositories/acme%20team/sdk%2Fcore/diffstat/a..b?page=2',
      'https://api.bitbucket.org/2.0/repositories/acme%20team/other/diffstat/a..b?page=2',
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/diff/a..b?page=2',
    ]
    for (const nextUrl of invalid) {
      await expect(
        executeBitbucketGetPullRequestDiffstatOperation({
          ...PULL_REQUEST_PARAMS,
          nextUrl,
        })
      ).rejects.toThrow()
    }
    expect(serverMocks.secureBitbucketRead).not.toHaveBeenCalled()
    expect(serverMocks.secureBitbucketPullRequestRedirect).not.toHaveBeenCalled()
  })

  it('normalizes executor-provided diffstat JSON through the same transform', async () => {
    serverMocks.secureBitbucketPullRequestRedirect.mockResolvedValueOnce(
      Response.json({ values: [RAW_DIFFSTAT], page: 3, pagelen: 20 })
    )
    const result = await executeBitbucketGetPullRequestDiffstatOperation(PULL_REQUEST_PARAMS)
    expect(result.output).toMatchObject({
      items: [{ newPath: 'src/new.ts', linesAdded: 12 }],
      page: { page: 3, pageLen: 20 },
    })
  })
})
