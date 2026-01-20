import type { ToolConfig } from '@/tools/types'

interface UnstarRepoParams {
  owner: string
  repo: string
  apiKey: string
}

interface UnstarRepoResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      unstarred: boolean
      owner: string
      repo: string
    }
  }
}

export const unstarRepoTool: ToolConfig<UnstarRepoParams, UnstarRepoResponse> = {
  id: 'github_unstar_repo',
  name: 'GitHub Unstar Repository',
  description: 'Remove star from a repository',
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
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const unstarred = response.status === 204

    return {
      success: unstarred,
      output: {
        content: unstarred
          ? `Successfully unstarred ${params?.owner}/${params?.repo}`
          : `Failed to unstar ${params?.owner}/${params?.repo}`,
        metadata: {
          unstarred,
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
      description: 'Unstar operation metadata',
      properties: {
        unstarred: { type: 'boolean', description: 'Whether unstarring succeeded' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
    },
  },
}

export const unstarRepoV2Tool: ToolConfig<UnstarRepoParams, any> = {
  id: 'github_unstar_repo_v2',
  name: unstarRepoTool.name,
  description: unstarRepoTool.description,
  version: '2.0.0',
  params: unstarRepoTool.params,
  request: unstarRepoTool.request,

  transformResponse: async (response: Response, params) => {
    const unstarred = response.status === 204
    return {
      success: unstarred,
      output: {
        unstarred,
        owner: params?.owner ?? '',
        repo: params?.repo ?? '',
      },
    }
  },

  outputs: {
    unstarred: { type: 'boolean', description: 'Whether unstarring succeeded' },
    owner: { type: 'string', description: 'Repository owner' },
    repo: { type: 'string', description: 'Repository name' },
  },
}
