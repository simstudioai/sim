import type { ToolConfig } from '@/tools/types'

interface StarRepoParams {
  owner: string
  repo: string
  apiKey: string
}

interface StarRepoResponse {
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

export const starRepoTool: ToolConfig<StarRepoParams, StarRepoResponse> = {
  id: 'github_star_repo',
  name: 'GitHub Star Repository',
  description: 'Star a repository',
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
    method: 'PUT',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Length': '0',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const starred = response.status === 204

    return {
      success: starred,
      output: {
        content: starred
          ? `Successfully starred ${params?.owner}/${params?.repo}`
          : `Failed to star ${params?.owner}/${params?.repo}`,
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
      description: 'Star operation metadata',
      properties: {
        starred: { type: 'boolean', description: 'Whether starring succeeded' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
    },
  },
}

export const starRepoV2Tool: ToolConfig<StarRepoParams, any> = {
  id: 'github_star_repo_v2',
  name: starRepoTool.name,
  description: starRepoTool.description,
  version: '2.0.0',
  params: starRepoTool.params,
  request: starRepoTool.request,

  transformResponse: async (response: Response, params) => {
    const starred = response.status === 204
    return {
      success: starred,
      output: {
        starred,
        owner: params?.owner ?? '',
        repo: params?.repo ?? '',
      },
    }
  },

  outputs: {
    starred: { type: 'boolean', description: 'Whether starring succeeded' },
    owner: { type: 'string', description: 'Repository owner' },
    repo: { type: 'string', description: 'Repository name' },
  },
}
