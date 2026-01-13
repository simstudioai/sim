import type { ClosePRParams, PRResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const closePRTool: ToolConfig<ClosePRParams, PRResponse> = {
  id: 'github_close_pr',
  name: 'GitHub Close Pull Request',
  description: 'Close a pull request in a GitHub repository',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`,
    method: 'PATCH',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: () => ({
      state: 'closed',
    }),
  },

  transformResponse: async (response) => {
    const pr = await response.json()

    const content = `PR #${pr.number} closed: "${pr.title}"
URL: ${pr.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          merged: pr.merged,
          draft: pr.draft,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable PR close confirmation' },
    metadata: {
      type: 'object',
      description: 'Closed pull request metadata',
      properties: {
        number: { type: 'number', description: 'Pull request number' },
        title: { type: 'string', description: 'PR title' },
        state: { type: 'string', description: 'PR state (should be closed)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        merged: { type: 'boolean', description: 'Whether PR is merged' },
        draft: { type: 'boolean', description: 'Whether PR is draft' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
      },
    },
  },
}

export const closePRV2Tool: ToolConfig<ClosePRParams, any> = {
  id: 'github_close_pr_v2',
  name: closePRTool.name,
  description: closePRTool.description,
  version: '2.0.0',
  params: closePRTool.params,
  request: closePRTool.request,

  transformResponse: async (response: Response) => {
    const pr = await response.json()
    return {
      success: true,
      output: {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        html_url: pr.html_url,
        body: pr.body ?? null,
        user: pr.user,
        head: pr.head,
        base: pr.base,
        draft: pr.draft,
        merged: pr.merged,
        closed_at: pr.closed_at ?? null,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'PR ID' },
    number: { type: 'number', description: 'PR number' },
    title: { type: 'string', description: 'PR title' },
    state: { type: 'string', description: 'PR state (closed)' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    body: { type: 'string', description: 'PR description', optional: true },
    user: { type: 'json', description: 'User who created the PR' },
    head: { type: 'json', description: 'Head branch info' },
    base: { type: 'json', description: 'Base branch info' },
    draft: { type: 'boolean', description: 'Whether PR is a draft' },
    merged: { type: 'boolean', description: 'Whether PR is merged' },
    closed_at: { type: 'string', description: 'Close timestamp', optional: true },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
  },
}
