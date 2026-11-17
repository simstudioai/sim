import { describe, expect, it, vi } from 'vitest'
import { checkStarTool, checkStarV2Tool } from '@/tools/github/check_star'
import { getFileContentTool } from '@/tools/github/get_file_content'
import { getProjectTool } from '@/tools/github/get_project'
import { listIssueCommentsTool } from '@/tools/github/list_issue_comments'
import { prV2Tool } from '@/tools/github/pr'
import { triggerWorkflowTool } from '@/tools/github/trigger_workflow'
import { updatePRTool } from '@/tools/github/update_pr'
import { updateProjectTool } from '@/tools/github/update_project'
import type { ToolConfig } from '@/tools/types'

function body(tool: ToolConfig, params: Record<string, unknown>): Record<string, unknown> {
  const built = tool.request.body?.(params)
  if (!built || typeof built !== 'object' || built instanceof FormData) {
    throw new Error(`${tool.id} built no JSON body`)
  }
  return built
}

function url(tool: ToolConfig, params: Record<string, unknown>): string {
  const { url: builder } = tool.request
  return typeof builder === 'function' ? builder(params) : builder
}

describe('github_check_star', () => {
  const params = { owner: 'octo', repo: 'demo', apiKey: 'ghp_test' }

  /**
   * GitHub's REST check answers "not starred" with a 404, which the executor
   * fails before any transform runs, so the answer has to come from a 200.
   */
  it.each([true, false])('reports viewerHasStarred=%s from a 200 response', async (starred) => {
    expect(body(checkStarTool, params).variables).toEqual({ owner: 'octo', name: 'demo' })
    const response = () => Response.json({ data: { repository: { viewerHasStarred: starred } } })

    const v1 = await checkStarTool.transformResponse?.(response(), params)
    const v2 = await checkStarV2Tool.transformResponse?.(response(), params)

    expect(v1?.output.metadata.starred).toBe(starred)
    expect(v2?.output.starred).toBe(starred)
  })

  it('fails rather than reporting false for a repository GitHub cannot resolve', async () => {
    const response = Response.json({
      data: { repository: null },
      errors: [{ message: "Could not resolve to a Repository with the name 'octo/nope'." }],
    })
    await expect(checkStarV2Tool.transformResponse?.(response, params)).rejects.toThrow(
      'Could not resolve'
    )
  })
})

describe('GitHub Projects GraphQL variables', () => {
  it('sends the short-input project number as the Int GraphQL requires', () => {
    const variables = body(getProjectTool, {
      owner_type: 'org',
      owner_login: 'octo',
      project_number: '1',
      apiKey: 'k',
    }).variables
    expect(variables).toEqual({ login: 'octo', number: 1 })
  })

  it('rejects a project number that is not a positive integer', () => {
    expect(() =>
      body(getProjectTool, { owner_type: 'org', owner_login: 'o', project_number: '1.5' })
    ).toThrow('positive integer')
  })

  it("sends the Public dropdown's string as the Boolean GraphQL requires", () => {
    const built = body(updateProjectTool, { project_id: 'PVT_1', project_public: 'false' })
    expect(built.variables).toEqual({ projectId: 'PVT_1', project_public: false })
  })

  it('leaves visibility out of the mutation for the "No change" option', () => {
    const built = body(updateProjectTool, { project_id: 'PVT_1', title: 'T', project_public: '' })
    expect(built.variables).toEqual({ projectId: 'PVT_1', title: 'T' })
    expect(built.query).not.toContain('$project_public')
  })
})

describe('github_trigger_workflow inputs', () => {
  const base = { owner: 'o', repo: 'r', workflow_id: 'ci.yml', ref: 'main' }

  it('parses the long-input JSON text into the object GitHub requires', () => {
    expect(body(triggerWorkflowTool, { ...base, inputs: '{"env":"prod"}' }).inputs).toEqual({
      env: 'prod',
    })
  })

  it("passes a model's object through and sends no inputs for blank text", () => {
    expect(body(triggerWorkflowTool, { ...base, inputs: { env: 'dev' } }).inputs).toEqual({
      env: 'dev',
    })
    expect(body(triggerWorkflowTool, { ...base, inputs: '  ' })).not.toHaveProperty('inputs')
  })

  it.each(['not json', '["a"]'])('rejects %j as workflow inputs', (inputs) => {
    expect(() => body(triggerWorkflowTool, { ...base, inputs })).toThrow('JSON object')
  })
})

describe('github_get_file_content URL', () => {
  it('keeps a # in the path and a + in the ref inside their URL parts', () => {
    const built = new URL(
      url(getFileContentTool, { owner: 'o', repo: 'r', path: 'docs/a#b.md', ref: 'feat+x' })
    )
    expect(built.pathname).toBe('/repos/o/r/contents/docs/a%23b.md')
    expect(built.searchParams.get('ref')).toBe('feat+x')
  })

  it('rejects a path that would climb out of the contents endpoint', () => {
    expect(() =>
      url(getFileContentTool, { owner: 'o', repo: 'r', path: 'docs/../../pulls' })
    ).toThrow('..')
  })
})

describe('github_list_issue_comments', () => {
  it('lists a comment whose author account is gone', async () => {
    const response = Response.json([
      {
        id: 1,
        body: 'hello',
        user: null,
        created_at: '2026-01-01T00:00:00Z',
        html_url: 'https://github.com/o/r/issues/1#c1',
      },
    ])
    const result = await listIssueCommentsTool.transformResponse?.(response)
    expect(result?.output.metadata.comments[0].user).toEqual({ login: null })
  })
})

describe('github_update_pr state', () => {
  it('sends no state for the "No change" option', () => {
    expect(
      body(updatePRTool, { owner: 'o', repo: 'r', pullNumber: 1, state: '' })
    ).not.toHaveProperty('state')
  })
})

describe('github_pr_v2 changed files', () => {
  it('stops before fetching file pages once the run is aborted', async () => {
    const filesFetch = vi.fn()
    vi.stubGlobal('fetch', filesFetch)
    const controller = new AbortController()
    controller.abort()
    const pr = Response.json({
      id: 1,
      number: 7,
      title: 'T',
      state: 'open',
      html_url: 'https://github.com/o/r/pull/7',
      diff_url: 'https://github.com/o/r/pull/7.diff',
      body: null,
      user: {
        login: 'o',
        id: 2,
        avatar_url: 'https://avatars.githubusercontent.com/u/2',
        html_url: 'https://github.com/o',
        type: 'User',
      },
      head: { label: 'o:f', sha: 'a'.repeat(40), ref: 'f' },
      base: { label: 'o:main', sha: 'b'.repeat(40), ref: 'main' },
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
    })

    await expect(
      prV2Tool.transformResponse?.(
        pr,
        { owner: 'o', repo: 'r', pullNumber: 7, apiKey: 'k' },
        { signal: controller.signal }
      )
    ).rejects.toThrow()
    expect(filesFetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
