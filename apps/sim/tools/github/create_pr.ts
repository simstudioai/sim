import type { CreatePRParams, PRResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const createPRTool: ToolConfig<CreatePRParams, PRResponse> = {
  id: 'github_create_pr',
  name: 'GitHub Create Pull Request',
  description: 'Create a new pull request in a GitHub repository',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request title',
    },
    head: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch where your changes are implemented',
    },
    base: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch you want the changes pulled into',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pull request description (Markdown)',
    },
    draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create as draft pull request',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/repos/${params.owner}/${params.repo}/pulls`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      title: params.title,
      head: params.head,
      base: params.base,
      body: params.body,
      draft: params.draft,
    }),
  },

  transformResponse: async (response) => {
    const pr = await response.json()

    const content = `PR #${pr.number} created: "${pr.title}" (${pr.state}${pr.draft ? ', draft' : ''})
From: ${pr.head.ref} → To: ${pr.base.ref}
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
    content: { type: 'string', description: 'Human-readable PR creation confirmation' },
    metadata: {
      type: 'object',
      description: 'Pull request metadata',
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
