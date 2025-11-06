import type { PRResponse, UpdatePRParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const updatePRTool: ToolConfig<UpdatePRParams, PRResponse> = {
  id: 'github_update_pr',
  name: 'GitHub Update Pull Request',
  description: 'Update an existing pull request in a GitHub repository',
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
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New pull request title',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New pull request description (Markdown)',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state (open or closed)',
    },
    base: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New base branch name',
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
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.body !== undefined) body.body = params.body
      if (params.state !== undefined) body.state = params.state
      if (params.base !== undefined) body.base = params.base
      return body
    },
  },

  transformResponse: async (response) => {
    const pr = await response.json()

    const content = `PR #${pr.number} updated: "${pr.title}" (${pr.state})
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
    content: { type: 'string', description: 'Human-readable PR update confirmation' },
    metadata: {
      type: 'object',
      description: 'Updated pull request metadata',
      properties: {
        number: { type: 'number', description: 'Pull request number' },
        title: { type: 'string', description: 'PR title' },
        state: { type: 'string', description: 'PR state (open/closed)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        merged: { type: 'boolean', description: 'Whether PR is merged' },
        draft: { type: 'boolean', description: 'Whether PR is draft' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
      },
    },
  },
}
