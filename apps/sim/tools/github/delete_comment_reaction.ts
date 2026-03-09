import type { ToolConfig } from '@/tools/types'

interface DeleteCommentReactionParams {
  owner: string
  repo: string
  comment_id: number
  reaction_id: number
  apiKey: string
}

interface DeleteCommentReactionResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      deleted: boolean
      reaction_id: number
    }
  }
}

export const deleteCommentReactionTool: ToolConfig<
  DeleteCommentReactionParams,
  DeleteCommentReactionResponse
> = {
  id: 'github_delete_comment_reaction',
  name: 'GitHub Delete Comment Reaction',
  description: 'Remove a reaction from an issue comment',
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
    reaction_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reaction ID to delete',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}/reactions/${params.reaction_id}`,
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github.squirrel-girl-preview+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const deleted = response.status === 204

    return {
      success: deleted,
      output: {
        content: deleted
          ? `Successfully deleted reaction ${params?.reaction_id}`
          : `Failed to delete reaction ${params?.reaction_id}`,
        metadata: {
          deleted,
          reaction_id: params?.reaction_id ?? 0,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Delete operation metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
        reaction_id: { type: 'number', description: 'The deleted reaction ID' },
      },
    },
  },
}

export const deleteCommentReactionV2Tool: ToolConfig<DeleteCommentReactionParams, any> = {
  id: 'github_delete_comment_reaction_v2',
  name: deleteCommentReactionTool.name,
  description: deleteCommentReactionTool.description,
  version: '2.0.0',
  params: deleteCommentReactionTool.params,
  request: deleteCommentReactionTool.request,

  transformResponse: async (response: Response, params) => {
    const deleted = response.status === 204
    return {
      success: deleted,
      output: {
        deleted,
        reaction_id: params?.reaction_id ?? 0,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
    reaction_id: { type: 'number', description: 'The deleted reaction ID' },
  },
}
