import { USER_FULL_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface ListStargazersParams {
  owner: string
  repo: string
  per_page?: number
  page?: number
  apiKey: string
}

interface ListStargazersResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      stargazers: Array<{
        login: string
        id: number
        avatar_url: string
        html_url: string
        type: string
      }>
      count: number
    }
  }
}

export const listStargazersTool: ToolConfig<ListStargazersParams, ListStargazersResponse> = {
  id: 'github_list_stargazers',
  name: 'GitHub List Stargazers',
  description: 'List users who have starred a repository',
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
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100, default: 30)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
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
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/stargazers`)
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const stargazers = data.map((u: any) => ({
      login: u.login,
      id: u.id,
      avatar_url: u.avatar_url,
      html_url: u.html_url,
      type: u.type,
    }))

    const content = `Found ${stargazers.length} stargazer(s):
${stargazers.map((u: any) => `@${u.login} (${u.type}) - ${u.html_url}`).join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          stargazers,
          count: stargazers.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable stargazer list' },
    metadata: {
      type: 'object',
      description: 'Stargazers metadata',
      properties: {
        stargazers: {
          type: 'array',
          description: 'Array of stargazers',
          items: {
            type: 'object',
            properties: {
              login: { type: 'string', description: 'Username' },
              id: { type: 'number', description: 'User ID' },
              avatar_url: { type: 'string', description: 'Avatar URL' },
              html_url: { type: 'string', description: 'Profile URL' },
              type: { type: 'string', description: 'User or Organization' },
            },
          },
        },
        count: { type: 'number', description: 'Number of stargazers returned' },
      },
    },
  },
}

export const listStargazersV2Tool: ToolConfig<ListStargazersParams, any> = {
  id: 'github_list_stargazers_v2',
  name: listStargazersTool.name,
  description: listStargazersTool.description,
  version: '2.0.0',
  params: listStargazersTool.params,
  request: listStargazersTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        items: data,
        count: data.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of user objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          ...USER_FULL_OUTPUT_PROPERTIES,
          gravatar_id: { type: 'string', description: 'Gravatar ID' },
          followers_url: { type: 'string', description: 'Followers API URL' },
          following_url: { type: 'string', description: 'Following API URL' },
          gists_url: { type: 'string', description: 'Gists API URL' },
          starred_url: { type: 'string', description: 'Starred API URL' },
          repos_url: { type: 'string', description: 'Repos API URL' },
        },
      },
    },
    count: { type: 'number', description: 'Number of stargazers returned' },
  },
}
