/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bitbucketCreateBranchTool } from '@/tools/bitbucket/create_branch'
import { bitbucketDeleteBranchTool } from '@/tools/bitbucket/delete_branch'
import { bitbucketGetCommitTool } from '@/tools/bitbucket/get_commit'
import { bitbucketGetFileTool } from '@/tools/bitbucket/get_file'
import { bitbucketGetFileMetadataTool } from '@/tools/bitbucket/get_file_metadata'
import { bitbucketGetRepositoryTool } from '@/tools/bitbucket/get_repository'
import { bitbucketTools } from '@/tools/bitbucket/index'
import { bitbucketListBranchesTool } from '@/tools/bitbucket/list_branches'
import { bitbucketListCommitsTool } from '@/tools/bitbucket/list_commits'
import { bitbucketListDirectoryTool } from '@/tools/bitbucket/list_directory'
import { bitbucketListRepositoriesTool } from '@/tools/bitbucket/list_repositories'
import { bitbucketListWorkspacesTool } from '@/tools/bitbucket/list_workspaces'
import type {
  BitbucketCreateBranchParams,
  BitbucketFileParams,
  BitbucketGetCommitParams,
  BitbucketGetFileParams,
  BitbucketListBranchesParams,
  BitbucketListCommitsParams,
  BitbucketListDirectoryParams,
  BitbucketListRepositoriesParams,
  BitbucketListWorkspacesParams,
  BitbucketRepositoryParams,
} from '@/tools/bitbucket/types'
import type { ToolConfig } from '@/tools/types'

const serverMocks = vi.hoisted(() => ({
  secureBitbucketRead: vi.fn(),
  secureBitbucketPullRequestRedirect: vi.fn(),
}))

vi.mock('@/tools/bitbucket/utils.server', () => serverMocks)

const REPOSITORY_PARAMS = {
  accessToken: 'oauth-token',
  workspaceSlug: 'acme team',
  repoSlug: 'sdk/core',
} as const

const COMMIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const FEATURE_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

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

const RAW_REPOSITORY = {
  type: 'repository',
  uuid: '{repo-1}',
  slug: 'demo',
  name: 'Demo repository',
  full_name: 'acme/demo',
  description: 'SDK repository',
  is_private: true,
  scm: 'git',
  language: 'typescript',
  size: 1234,
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-02T00:00:00Z',
  mainbranch: { name: 'main' },
  owner: RAW_USER,
  project: { uuid: '{project-1}', key: 'SDK', name: 'SDK' },
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo' },
    html: { href: 'https://bitbucket.org/acme/demo' },
  },
}

const RAW_COMMIT = {
  type: 'commit',
  hash: 'abc123',
  date: '2026-01-02T00:00:00Z',
  message: 'Ship it',
  summary: { raw: 'Ship it' },
  author: { raw: 'Ada <ada@example.test>', user: RAW_USER },
  committer: { raw: 'Ada <ada@example.test>', user: RAW_USER },
  parents: [{ type: 'commit', hash: 'parent123' }],
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo/commit/abc123' },
    html: { href: 'https://bitbucket.org/acme/demo/commits/abc123' },
  },
}

const RAW_BRANCH = {
  name: 'feature/demo',
  type: 'branch',
  target: RAW_COMMIT,
  merge_strategies: ['merge_commit', 'squash'],
  default_merge_strategy: 'merge_commit',
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo/refs/branches/feature' },
    html: { href: 'https://bitbucket.org/acme/demo/branch/feature' },
  },
}

function requestUrl<P, R>(tool: ToolConfig<P, R>, params: P): string {
  return typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
}

function requestBody<P, R>(tool: ToolConfig<P, R>, params: P): unknown {
  return tool.request.body?.(params)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('Bitbucket action tool contracts', () => {
  it('exports the complete 30-tool action-only surface', () => {
    expect(bitbucketTools.map((tool) => tool.id).sort()).toEqual(
      [
        'bitbucket_approve_pull_request',
        'bitbucket_create_branch',
        'bitbucket_create_pull_request',
        'bitbucket_create_pull_request_comment',
        'bitbucket_decline_pull_request',
        'bitbucket_delete_branch',
        'bitbucket_get_commit',
        'bitbucket_get_file',
        'bitbucket_get_file_metadata',
        'bitbucket_get_pipeline',
        'bitbucket_get_pipeline_step_log',
        'bitbucket_get_pull_request',
        'bitbucket_get_pull_request_diff',
        'bitbucket_get_pull_request_diffstat',
        'bitbucket_get_pull_request_merge_task_status',
        'bitbucket_get_repository',
        'bitbucket_list_branches',
        'bitbucket_list_commits',
        'bitbucket_list_directory',
        'bitbucket_list_pipeline_steps',
        'bitbucket_list_pipelines',
        'bitbucket_list_pull_request_comments',
        'bitbucket_list_pull_request_commit_statuses',
        'bitbucket_list_pull_requests',
        'bitbucket_list_repositories',
        'bitbucket_list_workspaces',
        'bitbucket_merge_pull_request',
        'bitbucket_request_pull_request_changes',
        'bitbucket_stop_pipeline',
        'bitbucket_trigger_pipeline',
      ].sort()
    )
  })

  it('uses hidden OAuth and the fixed Bitbucket provider on every action', () => {
    for (const tool of bitbucketTools) {
      expect(tool.oauth, tool.id).toMatchObject({ required: true, provider: 'bitbucket' })
      expect(tool.oauth?.requiredScopes?.length, tool.id).toBeGreaterThan(0)
      expect(tool.params.accessToken, tool.id).toMatchObject({
        type: 'string',
        required: true,
        visibility: 'hidden',
      })
    }
  })

  it('enables bounded retry only on safe reads, never on mutations', () => {
    for (const tool of bitbucketTools) {
      const method = typeof tool.request.method === 'function' ? null : tool.request.method
      if (method !== 'GET') {
        expect(tool.request.retry, tool.id).toBeUndefined()
      } else {
        expect(tool.request.retry, tool.id).toMatchObject({
          enabled: true,
          maxRetries: 2,
          retryIdempotentOnly: true,
        })
      }
    }
  })
})

describe('Bitbucket workspace and repository tools', () => {
  it('builds workspace and repository list filters with bounded pagination', () => {
    const workspaces = new URL(
      requestUrl(bitbucketListWorkspacesTool, {
        accessToken: 'oauth-token',
        sort: 'slug',
        administrator: false,
        pageLen: 10,
      } satisfies BitbucketListWorkspacesParams)
    )
    expect(workspaces.pathname).toBe('/2.0/user/workspaces')
    expect(Object.fromEntries(workspaces.searchParams)).toEqual({
      sort: 'slug',
      administrator: 'false',
      pagelen: '10',
    })

    const repositories = new URL(
      requestUrl(bitbucketListRepositoriesTool, {
        accessToken: 'oauth-token',
        workspaceSlug: 'team / blue',
        role: 'owner',
        q: 'name ~ "sdk"',
        sort: '-updated_on',
        pageLen: 40,
      } satisfies BitbucketListRepositoriesParams)
    )
    expect(repositories.pathname).toBe('/2.0/repositories/team%20%2F%20blue')
    expect(Object.fromEntries(repositories.searchParams)).toEqual({
      role: 'owner',
      q: 'name ~ "sdk"',
      sort: '-updated_on',
      pagelen: '40',
    })
    expect(() =>
      requestUrl(bitbucketListWorkspacesTool, {
        accessToken: 'oauth-token',
        administrator: 'false',
      } as unknown as BitbucketListWorkspacesParams)
    ).toThrow(/administrator must be a boolean/)
    expect(() =>
      requestUrl(bitbucketListRepositoriesTool, {
        accessToken: 'oauth-token',
        workspaceSlug: 'team',
        role: 'reader',
      } as unknown as BitbucketListRepositoriesParams)
    ).toThrow(/role must be one of/)
    expect(() =>
      requestUrl(bitbucketListRepositoriesTool, {
        accessToken: 'oauth-token',
        workspaceSlug: 'team',
        q: 0,
      } as unknown as BitbucketListRepositoriesParams)
    ).toThrow(/q must be a non-empty string/)
  })

  it('rejects a repository cursor from another workspace', () => {
    expect(() =>
      requestUrl(bitbucketListRepositoriesTool, {
        accessToken: 'oauth-token',
        workspaceSlug: 'acme',
        nextUrl: 'https://api.bitbucket.org/2.0/repositories/other?page=2',
      } satisfies BitbucketListRepositoriesParams)
    ).toThrow(/does not belong/)
  })

  it('encodes repository coordinates in detail URLs', () => {
    expect(requestUrl(bitbucketGetRepositoryTool, REPOSITORY_PARAMS)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore'
    )
  })

  it('normalizes workspace and repository responses', async () => {
    const workspaceResult = await bitbucketListWorkspacesTool.transformResponse!(
      Response.json({
        values: [
          {
            type: 'workspace_access',
            administrator: true,
            workspace: {
              slug: 'acme',
              uuid: '{workspace-1}',
              links: {
                self: { href: 'https://api.bitbucket.org/2.0/workspaces/acme' },
                avatar: { href: 'https://avatar.test/acme' },
              },
            },
          },
        ],
        size: 1,
        page: 1,
        pagelen: 20,
      })
    )
    expect(workspaceResult.output).toEqual({
      items: [
        {
          type: 'workspace_access',
          slug: 'acme',
          uuid: '{workspace-1}',
          administrator: true,
          selfUrl: 'https://api.bitbucket.org/2.0/workspaces/acme',
          avatarUrl: 'https://avatar.test/acme',
        },
      ],
      page: { size: 1, page: 1, pageLen: 20, nextUrl: null, previousUrl: null },
    })

    const listResult = await bitbucketListRepositoriesTool.transformResponse!(
      Response.json({ values: [RAW_REPOSITORY], size: 1, page: 1, pagelen: 20 })
    )
    const getResult = await bitbucketGetRepositoryTool.transformResponse!(
      Response.json(RAW_REPOSITORY)
    )
    expect(listResult.output.items[0]).toMatchObject({
      type: 'repository',
      uuid: '{repo-1}',
      slug: 'demo',
      fullName: 'acme/demo',
      mainBranch: 'main',
      owner: { accountId: 'account-1', displayName: 'Ada Lovelace' },
      project: { key: 'SDK' },
    })
    expect(getResult.output.repository).toEqual(listResult.output.items[0])
  })

  it('requires a non-empty resource type while preserving future type values', async () => {
    await expect(
      bitbucketGetRepositoryTool.transformResponse!(
        Response.json({ ...RAW_REPOSITORY, type: undefined })
      )
    ).rejects.toThrow(/repository\.type must be a non-empty string/)
    await expect(
      bitbucketGetRepositoryTool.transformResponse!(Response.json({ ...RAW_REPOSITORY, type: ' ' }))
    ).rejects.toThrow(/repository\.type must be a non-empty string/)

    const future = await bitbucketGetRepositoryTool.transformResponse!(
      Response.json({ ...RAW_REPOSITORY, type: 'future_repository_variant' })
    )
    expect(future.output.repository.type).toBe('future_repository_variant')
  })
})

describe('Bitbucket source tools', () => {
  it('builds encoded branch, commit, directory, and file URLs', () => {
    expect(
      requestUrl(bitbucketListBranchesTool, {
        ...REPOSITORY_PARAMS,
        q: 'name ~ "feature"',
        sort: '-name',
        pageLen: 5,
      } satisfies BitbucketListBranchesParams)
    ).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/refs/branches?q=name+%7E+%22feature%22&sort=-name&pagelen=5'
    )
    expect(
      requestUrl(bitbucketDeleteBranchTool, {
        ...REPOSITORY_PARAMS,
        name: 'feature/space ?#',
      })
    ).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/refs/branches/feature%2Fspace%20%3F%23'
    )
    expect(
      requestUrl(bitbucketGetCommitTool, {
        ...REPOSITORY_PARAMS,
        commit: COMMIT_SHA.toUpperCase(),
      } satisfies BitbucketGetCommitParams)
    ).toBe(`https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/commit/${COMMIT_SHA}`)
    expect(
      requestUrl(bitbucketGetFileMetadataTool, {
        ...REPOSITORY_PARAMS,
        commit: FEATURE_SHA,
        path: '/src/my file?#.ts/',
      } satisfies BitbucketFileParams)
    ).toBe(
      `https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/src/${FEATURE_SHA}/src/my%20file%3F%23.ts?format=meta`
    )
    expect(() =>
      requestUrl(bitbucketGetCommitTool, {
        ...REPOSITORY_PARAMS,
        commit: 'main',
      } satisfies BitbucketGetCommitParams)
    ).toThrow(/commit must be a full 40-character SHA-1/)
    expect(() =>
      requestUrl(bitbucketListDirectoryTool, {
        ...REPOSITORY_PARAMS,
        commit: 'abc123',
      } satisfies BitbucketListDirectoryParams)
    ).toThrow(/commit must be a full 40-character SHA-1/)
    expect(() =>
      requestUrl(bitbucketGetFileMetadataTool, {
        ...REPOSITORY_PARAMS,
        commit: 'feature/demo',
        path: 'README.md',
      } satisfies BitbucketFileParams)
    ).toThrow(/commit must be a full 40-character SHA-1/)
    expect(() =>
      requestUrl(bitbucketGetFileTool, {
        ...REPOSITORY_PARAMS,
        commit: true,
        path: 'README.md',
      } as unknown as BitbucketGetFileParams)
    ).toThrow(/commit must be a full 40-character SHA-1/)
  })

  it('keeps directory listing shallow and binds its cursor to the selected path', () => {
    const first = new URL(
      requestUrl(bitbucketListDirectoryTool, {
        ...REPOSITORY_PARAMS,
        commit: FEATURE_SHA,
        path: 'src/my dir',
        q: 'type = "commit_file"',
        sort: 'path',
        pageLen: 15,
      } satisfies BitbucketListDirectoryParams)
    )
    expect(first.pathname).toBe(
      `/2.0/repositories/acme%20team/sdk%2Fcore/src/${FEATURE_SHA}/src/my%20dir`
    )
    expect(Object.fromEntries(first.searchParams)).toEqual({
      q: 'type = "commit_file"',
      sort: 'path',
      pagelen: '15',
    })
    expect(bitbucketListDirectoryTool.params).not.toHaveProperty('maxDepth')

    const next = `https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/src/${FEATURE_SHA}/src/my%20dir?page=2`
    expect(
      requestUrl(bitbucketListDirectoryTool, {
        ...REPOSITORY_PARAMS,
        commit: FEATURE_SHA,
        path: 'src/my dir',
        nextUrl: next,
      } satisfies BitbucketListDirectoryParams)
    ).toBe(next)
    expect(() =>
      requestUrl(bitbucketListDirectoryTool, {
        ...REPOSITORY_PARAMS,
        commit: FEATURE_SHA,
        path: 'src/my dir',
        nextUrl: `https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/src/${FEATURE_SHA}/src/other?page=2`,
      } satisfies BitbucketListDirectoryParams)
    ).toThrow(/does not preserve/)
  })

  it('builds the documented create-branch body and never retries the mutation', () => {
    const params = {
      ...REPOSITORY_PARAMS,
      name: ' feature/demo ',
      target: ' abc123 ',
    } satisfies BitbucketCreateBranchParams
    expect(requestUrl(bitbucketCreateBranchTool, params)).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/refs/branches'
    )
    expect(requestBody(bitbucketCreateBranchTool, params)).toEqual({
      name: 'feature/demo',
      target: { hash: 'abc123' },
    })
    expect(bitbucketCreateBranchTool.request.retry).toBeUndefined()
  })

  it('normalizes branch, commit, directory, and metadata responses', async () => {
    const branches = await bitbucketListBranchesTool.transformResponse!(
      Response.json({ values: [RAW_BRANCH] })
    )
    const created = await bitbucketCreateBranchTool.transformResponse!(Response.json(RAW_BRANCH))
    expect(branches.output.items[0]).toMatchObject({
      type: 'branch',
      name: 'feature/demo',
      target: { type: 'commit', hash: 'abc123', author: { accountId: 'account-1' } },
      mergeStrategies: ['merge_commit', 'squash'],
    })
    expect(created.output.branch).toEqual(branches.output.items[0])

    const commits = await bitbucketListCommitsTool.transformResponse!(
      Response.json({ values: [RAW_COMMIT] })
    )
    const commit = await bitbucketGetCommitTool.transformResponse!(Response.json(RAW_COMMIT))
    expect(commits.output.items[0]).toMatchObject({
      type: 'commit',
      hash: 'abc123',
      summary: 'Ship it',
      authorRaw: 'Ada <ada@example.test>',
      parents: [{ hash: 'parent123' }],
    })
    expect(commit.output.commit).toEqual(commits.output.items[0])

    const directory = await bitbucketListDirectoryTool.transformResponse!(
      Response.json({
        values: [
          {
            type: 'commit_file',
            path: 'src/index.ts',
            commit: { hash: 'abc123' },
            size: 44,
            attributes: ['binary'],
            links: {
              self: { href: 'https://api.bitbucket.org/file' },
              meta: { href: 'https://api.bitbucket.org/file?format=meta' },
            },
          },
        ],
      })
    )
    expect(directory.output.items[0]).toEqual({
      type: 'commit_file',
      path: 'src/index.ts',
      commitHash: 'abc123',
      size: 44,
      attributes: ['binary'],
      isBinary: true,
      selfUrl: 'https://api.bitbucket.org/file',
      metadataUrl: 'https://api.bitbucket.org/file?format=meta',
    })

    const metadata = await bitbucketGetFileMetadataTool.transformResponse!(
      Response.json({
        type: 'commit_file',
        path: 'src/index.ts',
        commit: { hash: 'abc123' },
        escaped_path: 'src/index.ts',
        size: 44,
      })
    )
    expect(metadata.output.file).toMatchObject({ attributes: null, isBinary: null, size: 44 })
  })

  it('distinguishes absent, empty, and malformed optional source collections', async () => {
    const commitWithoutParents = await bitbucketGetCommitTool.transformResponse!(
      Response.json({ ...RAW_COMMIT, parents: undefined })
    )
    const commitWithNoParents = await bitbucketGetCommitTool.transformResponse!(
      Response.json({ ...RAW_COMMIT, parents: [] })
    )
    expect(commitWithoutParents.output.commit.parents).toBeNull()
    expect(commitWithNoParents.output.commit.parents).toEqual([])
    await expect(
      bitbucketGetCommitTool.transformResponse!(Response.json({ ...RAW_COMMIT, parents: null }))
    ).rejects.toThrow(/commit\.parents must be an array when present/)
    await expect(
      bitbucketGetCommitTool.transformResponse!(
        Response.json({ ...RAW_COMMIT, parents: [{ hash: 'missing-type' }] })
      )
    ).rejects.toThrow(/commit\.parents\[0\]\.type must be a non-empty string/)

    const branchWithoutStrategies = await bitbucketCreateBranchTool.transformResponse!(
      Response.json({ ...RAW_BRANCH, merge_strategies: undefined })
    )
    const branchWithNoStrategies = await bitbucketCreateBranchTool.transformResponse!(
      Response.json({ ...RAW_BRANCH, merge_strategies: [] })
    )
    expect(branchWithoutStrategies.output.branch.mergeStrategies).toBeNull()
    expect(branchWithNoStrategies.output.branch.mergeStrategies).toEqual([])
    await expect(
      bitbucketCreateBranchTool.transformResponse!(
        Response.json({ ...RAW_BRANCH, merge_strategies: ['future_strategy', 7] })
      )
    ).rejects.toThrow(/merge_strategies\[1\] must be a string/)

    const futureStrategy = await bitbucketCreateBranchTool.transformResponse!(
      Response.json({ ...RAW_BRANCH, merge_strategies: ['future_strategy'] })
    )
    expect(futureStrategy.output.branch.mergeStrategies).toEqual(['future_strategy'])
  })

  it('normalizes the exact commit_file metadata shape and rejects other source objects', async () => {
    const futureAttribute = await bitbucketGetFileMetadataTool.transformResponse!(
      Response.json({
        type: 'commit_file',
        path: 'src/index.ts',
        commit: { hash: 'abc123' },
        escaped_path: 'src/index.ts',
        size: null,
        attributes: ['future_attribute'],
      })
    )
    expect(futureAttribute.output.file).toEqual({
      type: 'commit_file',
      path: 'src/index.ts',
      commitHash: 'abc123',
      escapedPath: 'src/index.ts',
      size: null,
      attributes: ['future_attribute'],
      isBinary: false,
    })

    await expect(
      bitbucketGetFileMetadataTool.transformResponse!(
        Response.json({ type: 'commit_directory', path: 'src' })
      )
    ).rejects.toThrow(/directory; use list_directory/)
    await expect(
      bitbucketGetFileMetadataTool.transformResponse!(
        Response.json({ type: 'commit_file', path: 'src/index.ts', attributes: 'binary' })
      )
    ).resolves.toMatchObject({
      output: { file: { attributes: ['binary'], isBinary: true } },
    })
    await expect(
      bitbucketGetFileMetadataTool.transformResponse!(
        Response.json({ type: 'commit_file', path: 'src/index.ts', attributes: ['binary', 7] })
      )
    ).rejects.toThrow(/metadata\.attributes\[1\] must be a string/)
    await expect(
      bitbucketGetFileMetadataTool.transformResponse!(
        Response.json({ type: 'commit_file', path: 'src/index.ts', size: '44' })
      )
    ).rejects.toThrow(/metadata\.size must be a finite number or null/)
  })

  it('preserves future directory-entry types and attributes without enum gating', async () => {
    const result = await bitbucketListDirectoryTool.transformResponse!(
      Response.json({
        values: [
          {
            type: 'future_source_entry',
            path: 'src/new-kind',
            attributes: ['future_attribute'],
          },
          { type: 'commit_file', path: 'empty.txt', attributes: [] },
          { type: 'commit_directory', path: 'src' },
        ],
      })
    )
    expect(result.output.items[0]).toMatchObject({
      type: 'future_source_entry',
      attributes: ['future_attribute'],
      isBinary: false,
    })
    expect(result.output.items[1]).toMatchObject({ attributes: [], isBinary: false })
    expect(result.output.items[2]).toMatchObject({ attributes: null, isBinary: null })
    await expect(
      bitbucketListDirectoryTool.transformResponse!(
        Response.json({
          values: [{ type: 'commit_file', path: 'bad.txt', attributes: ['executable', 7] }],
        })
      )
    ).rejects.toThrow(/directory entry\.attributes\[1\] must be a string/)
  })

  it('treats successful destructive 204 responses as completion', async () => {
    const result = await bitbucketDeleteBranchTool.transformResponse!(
      new Response(null, { status: 204 })
    )
    expect(result).toEqual({ success: true, output: { deleted: true } })
    for (const status of [200, 202, 205]) {
      await expect(
        bitbucketDeleteBranchTool.transformResponse!(new Response(null, { status }))
      ).rejects.toThrow(`unexpected HTTP ${status}`)
    }
  })

  it('preflights file metadata and returns no raw bytes for a documented binary file', async () => {
    serverMocks.secureBitbucketRead.mockResolvedValueOnce(
      Response.json({
        type: 'commit_file',
        path: 'assets/logo.png',
        commit: { hash: 'abc123' },
        size: 1_024,
        attributes: ['binary'],
      })
    )
    const params = {
      ...REPOSITORY_PARAMS,
      commit: FEATURE_SHA,
      path: 'assets/logo.png',
    } satisfies BitbucketGetFileParams

    const result = await bitbucketGetFileTool.directExecution!(params)

    expect(result).toEqual({
      success: true,
      output: {
        content: null,
        binary: true,
        truncated: true,
        returnedBytes: 0,
        fullBytes: 1_024,
        contentType: null,
      },
    })
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledTimes(1)
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledWith(
      `https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/src/${FEATURE_SHA}/assets/logo.png?format=meta`,
      expect.objectContaining({ Authorization: 'Bearer oauth-token' }),
      256 * 1024,
      { signal: undefined }
    )
  })

  it.each([
    { size: 0, truncated: false, fullBytes: 0 },
    { size: undefined, truncated: null, fullBytes: null },
  ])(
    'reports binary size $size as truncated=$truncated',
    async ({ size, truncated, fullBytes }) => {
      serverMocks.secureBitbucketRead.mockResolvedValueOnce(
        Response.json({
          type: 'commit_file',
          path: 'assets/logo.png',
          commit: { hash: 'abc123' },
          ...(size !== undefined ? { size } : {}),
          attributes: ['binary'],
        })
      )

      const result = await bitbucketGetFileTool.directExecution!({
        ...REPOSITORY_PARAMS,
        commit: COMMIT_SHA,
        path: 'assets/logo.png',
      })

      expect(result.output).toEqual({
        content: null,
        binary: true,
        truncated,
        returnedBytes: 0,
        fullBytes,
        contentType: null,
      })
      expect(serverMocks.secureBitbucketRead).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects directory metadata without making a raw-content request', async () => {
    serverMocks.secureBitbucketRead.mockResolvedValueOnce(
      Response.json({ type: 'commit_directory', path: 'src' })
    )

    await expect(
      bitbucketGetFileTool.directExecution!({
        ...REPOSITORY_PARAMS,
        commit: COMMIT_SHA,
        path: 'src',
      })
    ).rejects.toThrow(/directory; use list_directory/)
    expect(serverMocks.secureBitbucketRead).toHaveBeenCalledTimes(1)
  })

  it('validates maxCharacters before the metadata preflight', async () => {
    await expect(
      bitbucketGetFileTool.directExecution!({
        ...REPOSITORY_PARAMS,
        commit: COMMIT_SHA,
        path: 'README.md',
        maxCharacters: 0,
      })
    ).rejects.toThrow(/maxCharacters must be an integer between 1 and 500000/)
    expect(serverMocks.secureBitbucketRead).not.toHaveBeenCalled()
    await expect(
      bitbucketGetFileTool.directExecution!({
        ...REPOSITORY_PARAMS,
        commit: 'main',
        path: 'README.md',
      })
    ).rejects.toThrow(/commit must be a full 40-character SHA-1/)
    expect(serverMocks.secureBitbucketRead).not.toHaveBeenCalled()
    expect(bitbucketGetFileTool.outputs?.truncated).toMatchObject({
      type: 'boolean',
      nullable: true,
    })
  })

  it('reads a bounded raw file when metadata says text or remains unknown', async () => {
    serverMocks.secureBitbucketRead
      .mockResolvedValueOnce(
        Response.json({
          type: 'commit_file',
          path: 'src/my file.ts',
          commit: { hash: 'abc123' },
          size: 5,
        })
      )
      .mockResolvedValueOnce(
        new Response('hello', {
          headers: { 'Content-Length': '5', 'Content-Type': 'text/plain' },
        })
      )
    const params = {
      ...REPOSITORY_PARAMS,
      commit: COMMIT_SHA,
      path: 'src/my file.ts',
      maxCharacters: 4,
    } satisfies BitbucketGetFileParams

    const result = await bitbucketGetFileTool.directExecution!(params)

    expect(result).toEqual({
      success: true,
      output: {
        content: 'hell',
        binary: null,
        truncated: true,
        returnedBytes: 5,
        fullBytes: 5,
        contentType: 'text/plain',
      },
    })
    expect(serverMocks.secureBitbucketRead).toHaveBeenNthCalledWith(
      2,
      `https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/src/${COMMIT_SHA}/src/my%20file.ts`,
      expect.objectContaining({
        Accept: '*/*',
        Authorization: 'Bearer oauth-token',
        Range: 'bytes=0-15',
      }),
      10 * 1024 * 1024,
      { stripAuthOnRedirect: true, signal: undefined }
    )
  })

  it('uses metadata size when raw bytes reveal binary content with an unknown range total', async () => {
    serverMocks.secureBitbucketRead
      .mockResolvedValueOnce(
        Response.json({
          type: 'commit_file',
          path: 'unknown.bin',
          commit: { hash: COMMIT_SHA },
          size: 3,
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([65, 0, 66]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-2/*' },
        })
      )

    const result = await bitbucketGetFileTool.directExecution!({
      ...REPOSITORY_PARAMS,
      commit: COMMIT_SHA,
      path: 'unknown.bin',
    })

    expect(result.output).toMatchObject({
      content: null,
      binary: true,
      truncated: true,
      returnedBytes: 3,
      fullBytes: 3,
    })
  })

  it('uses the normal HTTP path only as a guarded executor fallback', async () => {
    expect(bitbucketGetFileTool.request.stripAuthOnRedirect).toBe(true)
    await expect(
      bitbucketGetFileTool.transformResponse!(new Response('content'), {
        ...REPOSITORY_PARAMS,
        commit: COMMIT_SHA,
        path: 'README.md',
      })
    ).rejects.toThrow(/metadata preflight direct execution path/)
  })

  it('builds the list-commits endpoint with its opaque cursor bound', () => {
    const first = requestUrl(bitbucketListCommitsTool, {
      ...REPOSITORY_PARAMS,
      pageLen: 30,
    } satisfies BitbucketListCommitsParams)
    expect(first).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/commits?pagelen=30'
    )
    expect(() =>
      requestUrl(bitbucketListCommitsTool, {
        ...REPOSITORY_PARAMS,
        nextUrl:
          'https://api.bitbucket.org/2.0/repositories/acme%20team/sdk%2Fcore/pipelines?page=2',
      } satisfies BitbucketListCommitsParams)
    ).toThrow(/does not belong/)
  })

  it('sets JSON content headers only on JSON mutations', () => {
    const createHeaders = bitbucketCreateBranchTool.request.headers({
      ...REPOSITORY_PARAMS,
      name: 'feature',
      target: 'main',
    })
    const getHeaders = bitbucketGetRepositoryTool.request.headers(
      REPOSITORY_PARAMS satisfies BitbucketRepositoryParams
    )
    expect(createHeaders).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer oauth-token',
      'Content-Type': 'application/json',
    })
    expect(getHeaders).not.toHaveProperty('Content-Type')
  })
})
