import { REACTION_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface CreateIssueReactionParams {
  owner: string
  repo: string
  issue_number: number
  content: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes'
  apiKey: string
}

interface CreateIssueReactionResponse {
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

export const createIssueReactionTool: ToolConfig<
  CreateIssueReactionParams,
  CreateIssueReactionResponse
> = {
  id: 'github_create_issue_reaction',
  name: 'GitHub Create Issue Reaction',
  description: 'Add a reaction to an issue',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/reactions`,
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

    const content = `Added ${data.content} reaction to issue by ${data.user?.login ?? 'unknown'}`

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

export const createIssueReactionV2Tool: ToolConfig<CreateIssueReactionParams, any> = {
  id: 'github_create_issue_reaction_v2',
  name: createIssueReactionTool.name,
  description: createIssueReactionTool.description,
  version: '2.0.0',
  params: createIssueReactionTool.params,
  request: createIssueReactionTool.request,

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
