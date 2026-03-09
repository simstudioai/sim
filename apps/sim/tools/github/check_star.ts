import type { ToolConfig } from '@/tools/types'

interface CheckStarParams {
  owner: string
  repo: string
  apiKey: string
}

interface CheckStarResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      starred: boolean
      owner: string
      repo: string
    }
  }
}

export const checkStarTool: ToolConfig<CheckStarParams, CheckStarResponse> = {
  id: 'github_check_star',
  name: 'GitHub Check Star',
  description: 'Check if you have starred a repository',
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/user/starred/${params.owner}/${params.repo}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const starred = response.status === 204

    return {
      success: true,
      output: {
        content: starred
          ? `You have starred ${params?.owner}/${params?.repo}`
          : `You have not starred ${params?.owner}/${params?.repo}`,
        metadata: {
          starred,
          owner: params?.owner ?? '',
          repo: params?.repo ?? '',
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Check star metadata',
      properties: {
        starred: { type: 'boolean', description: 'Whether you have starred the repo' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
    },
  },
}

export const checkStarV2Tool: ToolConfig<CheckStarParams, any> = {
  id: 'github_check_star_v2',
  name: checkStarTool.name,
  description: checkStarTool.description,
  version: '2.0.0',
  params: checkStarTool.params,
  request: checkStarTool.request,

  transformResponse: async (response: Response, params) => {
    const starred = response.status === 204
    return {
      success: true,
      output: {
        starred,
        owner: params?.owner ?? '',
        repo: params?.repo ?? '',
      },
    }
  },

  outputs: {
    starred: { type: 'boolean', description: 'Whether you have starred the repo' },
    owner: { type: 'string', description: 'Repository owner' },
    repo: { type: 'string', description: 'Repository name' },
  },
}
