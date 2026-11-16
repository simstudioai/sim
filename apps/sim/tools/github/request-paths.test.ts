import { describe, expect, it } from 'vitest'
import { executeGitHubTool } from '@/lib/internal/github/execute-tool'
import { getGitHubLatestCommit } from '@/lib/internal/github/operations'
import { compareCommitsTool } from '@/tools/github/compare_commits'
import { deleteBranchTool } from '@/tools/github/delete_branch'
import { getBranchTool } from '@/tools/github/get_branch'
import { getGistTool } from '@/tools/github/get_gist'
import { getIssueTool } from '@/tools/github/get_issue'
import { getWorkflowTool } from '@/tools/github/get_workflow'
import { listGistsTool } from '@/tools/github/list_gists'
import { repoInfoTool } from '@/tools/github/repo_info'
import { starRepoTool } from '@/tools/github/star_repo'
import type { ToolConfig } from '@/tools/types'

function url(tool: ToolConfig, params: Record<string, unknown>): string {
  const { url: builder } = tool.request
  return typeof builder === 'function' ? builder({ apiKey: 'ghp_test', ...params }) : builder
}

describe('GitHub request paths', () => {
  it.each([
    ['octocat', 'Hello-World'],
    ['my-org', 'repo.name_2'],
    ['a1', '.github'],
    ['user-123', 'x..y'],
  ])('leaves real owner %s and repo %s byte identical', (owner, repo) => {
    expect(url(repoInfoTool, { owner, repo })).toBe(`https://api.github.com/repos/${owner}/${repo}`)
    expect(url(starRepoTool, { owner, repo })).toBe(
      `https://api.github.com/user/starred/${owner}/${repo}`
    )
  })

  it.each([
    [{ owner: '..', repo: 'demo' }, /owner cannot be "\.\."/],
    [{ owner: 'octo', repo: '.' }, /repo cannot be "\."/],
    [{ owner: 'orgs/acme', repo: 'demo' }, /owner cannot contain a path separator/],
    [{ owner: 'octo', repo: 'demo\\..' }, /repo cannot contain a path separator/],
  ])('rejects an owner or repo that would leave the repository path', (params, error) => {
    expect(() => url(repoInfoTool, params)).toThrow(error)
    expect(() => url(starRepoTool, params)).toThrow(error)
  })

  it('escapes a query or fragment delimiter instead of letting it end the path', () => {
    expect(url(repoInfoTool, { owner: 'octo', repo: 'x?y' })).toBe(
      'https://api.github.com/repos/octo/x%3Fy'
    )
    expect(url(repoInfoTool, { owner: 'octo#z', repo: 'demo' })).toBe(
      'https://api.github.com/repos/octo%23z/demo'
    )
  })

  it('rejects a numeric id that smuggles extra segments', () => {
    const params = { owner: 'octo', repo: 'demo' }

    expect(url(getIssueTool, { ...params, issue_number: 42 })).toBe(
      'https://api.github.com/repos/octo/demo/issues/42'
    )
    expect(() => url(getIssueTool, { ...params, issue_number: '1/../../../user' })).toThrow(
      /issue_number cannot contain a path separator/
    )
  })

  it('keeps workflow file names and gist ids as one segment', () => {
    const params = { owner: 'octo', repo: 'demo' }

    expect(url(getWorkflowTool, { ...params, workflow_id: 'deploy@v2+prod.yml' })).toBe(
      'https://api.github.com/repos/octo/demo/actions/workflows/deploy@v2+prod.yml'
    )
    expect(() => url(getWorkflowTool, { ...params, workflow_id: '../../hooks' })).toThrow(
      /workflow_id cannot contain a path separator/
    )
    expect(url(getGistTool, { gist_id: ' aa5a315d61ae9438b18d ' })).toBe(
      'https://api.github.com/gists/aa5a315d61ae9438b18d'
    )
    expect(() => url(getGistTool, { gist_id: '..' })).toThrow(/gist_id cannot be "\.\."/)
    expect(() => url(listGistsTool, { username: 'octo/repos' })).toThrow(
      /username cannot contain a path separator/
    )
  })

  it('keeps the slashes and raw-safe characters of a branch byte identical', () => {
    const params = { owner: 'octo', repo: 'demo' }

    expect(url(getBranchTool, { ...params, branch: 'feature/login+v2@team' })).toBe(
      'https://api.github.com/repos/octo/demo/branches/feature/login+v2@team'
    )
    expect(url(deleteBranchTool, { ...params, branch: 'users/jane/fix' })).toBe(
      'https://api.github.com/repos/octo/demo/git/refs/heads/users/jane/fix'
    )
    expect(url(compareCommitsTool, { ...params, base: 'main', head: 'release/1.2' })).toBe(
      'https://api.github.com/repos/octo/demo/compare/main...release/1.2'
    )
  })

  it('accepts a numeric ref or branch sent as a JSON number', () => {
    const params = { owner: 'octo', repo: 'demo' }

    expect(url(getBranchTool, { ...params, branch: 2024 })).toBe(
      'https://api.github.com/repos/octo/demo/branches/2024'
    )
    expect(url(compareCommitsTool, { ...params, base: 1234567, head: 'main' })).toBe(
      'https://api.github.com/repos/octo/demo/compare/1234567...main'
    )
  })

  it('escapes delimiters in a branch and rejects its dot segments', () => {
    const params = { owner: 'octo', repo: 'demo' }

    expect(url(getBranchTool, { ...params, branch: 'a?b#c' })).toBe(
      'https://api.github.com/repos/octo/demo/branches/a%3Fb%23c'
    )
    expect(() => url(deleteBranchTool, { ...params, branch: 'x/../../../../hooks' })).toThrow(
      /branch cannot contain "\." or "\.\." path segments/
    )
    expect(() => url(compareCommitsTool, { ...params, base: 'main', head: '..' })).toThrow(
      /head cannot contain "\." or "\.\." path segments/
    )
  })

  it('rejects a traversal owner in the latest-commit operation as a 400 before any request', async () => {
    await expect(
      getGitHubLatestCommit(
        { owner: '..', repo: 'demo', apiKey: 'ghp_test' },
        { requestId: 'test-request' }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: 'owner cannot be ".." (path traversal is not allowed)',
    })
  })

  it('answers a traversal owner in the PR comment operation with a 400', async () => {
    const response = await executeGitHubTool({
      toolId: 'github_comment',
      input: { owner: 'octo', repo: '..', body: 'hi', pullNumber: 1, apiKey: 'ghp_test' },
      headers: new Headers(),
      context: { workflowId: 'workflow-1' },
      requestId: 'test-request',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'repo cannot be ".." (path traversal is not allowed)',
    })
  })
})
