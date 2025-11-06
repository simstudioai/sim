import type { CreateIssueCommentParams, IssueCommentResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const issueCommentTool: ToolConfig<CreateIssueCommentParams, IssueCommentResponse> = {
  id: 'github_issue_comment',
  name: 'GitHub Issue Comment Creator',
  description: 'Create a comment on a GitHub issue',
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
    issue_number: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue number',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment content',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      body: params.body,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Comment created on issue #${data.issue_url.split('/').pop()}: "${data.body.substring(0, 100)}${data.body.length > 100 ? '...' : ''}"`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          html_url: data.html_url,
          body: data.body,
          created_at: data.created_at,
          updated_at: data.updated_at,
          user: {
            login: data.user.login,
            id: data.user.id,
          },
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable comment confirmation' },
    metadata: {
      type: 'object',
      description: 'Comment metadata',
      properties: {
        id: { type: 'number', description: 'Comment ID' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        body: { type: 'string', description: 'Comment body' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        user: {
          type: 'object',
          description: 'User who created the comment',
          properties: {
            login: { type: 'string', description: 'User login' },
            id: { type: 'number', description: 'User ID' },
          },
        },
      },
    },
  },
}
