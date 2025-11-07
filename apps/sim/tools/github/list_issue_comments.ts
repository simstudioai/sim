import type { CommentsListResponse, ListIssueCommentsParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listIssueCommentsTool: ToolConfig<ListIssueCommentsParams, CommentsListResponse> = {
  id: 'github_list_issue_comments',
  name: 'GitHub Issue Comments Lister',
  description: 'List all comments on a GitHub issue',
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
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only show comments updated after this ISO 8601 timestamp',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 100)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`
      const queryParams = new URLSearchParams()

      if (params.since) queryParams.append('since', params.since)
      if (params.per_page) queryParams.append('per_page', Number(params.per_page).toString())
      if (params.page) queryParams.append('page', Number(params.page).toString())

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Found ${data.length} comment${data.length !== 1 ? 's' : ''} on issue #${response.url.split('/').slice(-2, -1)[0]}${
      data.length > 0
        ? `\n\nRecent comments:\n${data
            .slice(0, 5)
            .map(
              (c: any) =>
                `- ${c.user.login} (${new Date(c.created_at).toLocaleDateString()}): "${c.body.substring(0, 80)}${c.body.length > 80 ? '...' : ''}"`
            )
            .join('\n')}`
        : ''
    }`

    return {
      success: true,
      output: {
        content,
        metadata: {
          comments: data.map((comment: any) => ({
            id: comment.id,
            body: comment.body,
            user: { login: comment.user.login },
            created_at: comment.created_at,
            html_url: comment.html_url,
          })),
          total_count: data.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable comments summary' },
    metadata: {
      type: 'object',
      description: 'Comments list metadata',
      properties: {
        comments: {
          type: 'array',
          description: 'Array of comment objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Comment ID' },
              body: { type: 'string', description: 'Comment body' },
              user: {
                type: 'object',
                description: 'User who created the comment',
                properties: {
                  login: { type: 'string', description: 'User login' },
                },
              },
              created_at: { type: 'string', description: 'Creation timestamp' },
              html_url: { type: 'string', description: 'GitHub web URL' },
            },
          },
        },
        total_count: { type: 'number', description: 'Total number of comments' },
      },
    },
  },
}
