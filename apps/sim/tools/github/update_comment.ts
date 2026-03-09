import type { IssueCommentResponse, UpdateCommentParams } from '@/tools/github/types'
import { COMMENT_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const updateCommentTool: ToolConfig<UpdateCommentParams, IssueCommentResponse> = {
  id: 'github_update_comment',
  name: 'GitHub Comment Updater',
  description: 'Update an existing comment on a GitHub issue or pull request',
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
    comment_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment ID',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Updated comment content',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}`,
    method: 'PATCH',
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

    const content = `Comment #${data.id} updated: "${data.body.substring(0, 100)}${data.body.length > 100 ? '...' : ''}"`

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
    content: { type: 'string', description: 'Human-readable update confirmation' },
    metadata: {
      type: 'object',
      description: 'Updated comment metadata',
      properties: {
        id: { type: 'number', description: 'Comment ID' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        body: { type: 'string', description: 'Updated comment body' },
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

export const updateCommentV2Tool: ToolConfig = {
  id: 'github_update_comment_v2',
  name: updateCommentTool.name,
  description: updateCommentTool.description,
  version: '2.0.0',
  params: updateCommentTool.params,
  request: updateCommentTool.request,
  oauth: updateCommentTool.oauth,
  transformResponse: async (response: Response) => {
    const comment = await response.json()
    return {
      success: true,
      output: {
        id: comment.id,
        body: comment.body,
        html_url: comment.html_url,
        user: comment.user,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
      },
    }
  },
  outputs: {
    ...COMMENT_OUTPUT_PROPERTIES,
    user: USER_OUTPUT,
  },
}
