import { REPO_FULL_OUTPUT_PROPERTIES, USER_FULL_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface ListForksParams {
  owner: string
  repo: string
  sort?: 'newest' | 'oldest' | 'stargazers' | 'watchers'
  per_page?: number
  page?: number
  apiKey: string
}

interface ListForksResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      forks: Array<{
        id: number
        full_name: string
        html_url: string
        owner: { login: string }
        stargazers_count: number
        forks_count: number
        created_at: string
        updated_at: string
        default_branch: string
      }>
      count: number
    }
  }
}

export const listForksTool: ToolConfig<ListForksParams, ListForksResponse> = {
  id: 'github_list_forks',
  name: 'GitHub List Forks',
  description: 'List forks of a repository',
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
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: newest, oldest, stargazers, watchers (default: newest)',
      default: 'newest',
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
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/forks`)
      if (params.sort) url.searchParams.append('sort', params.sort)
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

    const forks = data.map((f: any) => ({
      id: f.id,
      full_name: f.full_name,
      html_url: f.html_url,
      owner: { login: f.owner?.login ?? 'unknown' },
      stargazers_count: f.stargazers_count,
      forks_count: f.forks_count,
      created_at: f.created_at,
      updated_at: f.updated_at,
      default_branch: f.default_branch,
    }))

    const content = `Found ${forks.length} fork(s):
${forks
  .map(
    (f: any) =>
      `${f.full_name} ⭐ ${f.stargazers_count}
  Owner: ${f.owner.login}
  ${f.html_url}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          forks,
          count: forks.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable fork list' },
    metadata: {
      type: 'object',
      description: 'Forks metadata',
      properties: {
        forks: {
          type: 'array',
          description: 'Array of forks',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Repository ID' },
              full_name: { type: 'string', description: 'Full name' },
              html_url: { type: 'string', description: 'Web URL' },
              owner: { type: 'object', description: 'Owner info' },
              stargazers_count: { type: 'number', description: 'Star count' },
              forks_count: { type: 'number', description: 'Fork count' },
              created_at: { type: 'string', description: 'Creation date' },
              updated_at: { type: 'string', description: 'Update date' },
              default_branch: { type: 'string', description: 'Default branch' },
            },
          },
        },
        count: { type: 'number', description: 'Number of forks returned' },
      },
    },
  },
}

export const listForksV2Tool: ToolConfig<ListForksParams, any> = {
  id: 'github_list_forks_v2',
  name: listForksTool.name,
  description: listForksTool.description,
  version: '2.0.0',
  params: listForksTool.params,
  request: listForksTool.request,

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
      description: 'Array of fork repository objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          ...REPO_FULL_OUTPUT_PROPERTIES,
          owner: {
            type: 'object',
            description: 'Fork owner',
            properties: USER_FULL_OUTPUT_PROPERTIES,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of forks returned' },
  },
}
