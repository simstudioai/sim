import { REACTION_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface CreateCommentReactionParams {
  owner: string
  repo: string
  comment_id: number
  content: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes'
  apiKey: string
}

interface CreateCommentReactionResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: number
      user: { login: string }
      content: string
      created_at: string
    }
  }
}

export const createCommentReactionTool: ToolConfig<
  CreateCommentReactionParams,
  CreateCommentReactionResponse
> = {
  id: 'github_create_comment_reaction',
  name: 'GitHub Create Comment Reaction',
  description: 'Add a reaction to an issue comment',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Reaction type: +1 (thumbs up), -1 (thumbs down), laugh, confused, heart, hooray, rocket, eyes',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}/reactions`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.squirrel-girl-preview+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      content: params.content,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Added ${data.content} reaction to comment by ${data.user?.login ?? 'unknown'}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          user: { login: data.user?.login ?? 'unknown' },
          content: data.content,
          created_at: data.created_at,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Reaction metadata',
      properties: {
        id: { type: 'number', description: 'Reaction ID' },
        user: { type: 'object', description: 'User who reacted' },
        content: { type: 'string', description: 'Reaction type' },
        created_at: { type: 'string', description: 'Creation date' },
      },
    },
  },
}

export const createCommentReactionV2Tool: ToolConfig<CreateCommentReactionParams, any> = {
  id: 'github_create_comment_reaction_v2',
  name: createCommentReactionTool.name,
  description: createCommentReactionTool.description,
  version: '2.0.0',
  params: createCommentReactionTool.params,
  request: createCommentReactionTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    ...REACTION_OUTPUT_PROPERTIES,
    user: { ...USER_OUTPUT, optional: true },
  },
}
