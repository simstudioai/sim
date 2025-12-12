import type { DeleteCommentParams, DeleteCommentResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const deleteCommentTool: ToolConfig<DeleteCommentParams, DeleteCommentResponse> = {
  id: 'github_delete_comment',
  name: 'GitHub Comment Deleter',
  description: 'Delete a comment on a GitHub issue or pull request',
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
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const content = `Comment #${response.url.split('/').pop()} successfully deleted`

    return {
      success: true,
      output: {
        content,
        metadata: {
          deleted: true,
          comment_id: Number(response.url.split('/').pop()),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable deletion confirmation' },
    metadata: {
      type: 'object',
      description: 'Deletion result metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether deletion was successful' },
        comment_id: { type: 'number', description: 'Deleted comment ID' },
      },
    },
  },
}
