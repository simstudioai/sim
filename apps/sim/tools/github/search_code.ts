import type { ToolConfig } from '@/tools/types'

interface SearchCodeParams {
  q: string
  sort?: 'indexed'
  order?: 'asc' | 'desc'
  per_page?: number
  page?: number
  apiKey: string
}

interface SearchCodeResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      total_count: number
      incomplete_results: boolean
      items: Array<{
        name: string
        path: string
        sha: string
        html_url: string
        repository: {
          full_name: string
          html_url: string
        }
      }>
    }
  }
}

export const searchCodeTool: ToolConfig<SearchCodeParams, SearchCodeResponse> = {
  id: 'github_search_code',
  name: 'GitHub Search Code',
  description:
    'Search for code across GitHub repositories. Use qualifiers like repo:owner/name, language:js, path:src, extension:py',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query with optional qualifiers (repo:, language:, path:, extension:, user:, org:)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by indexed date (default: best match)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc or desc (default: desc)',
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
      const url = new URL('https://api.github.com/search/code')
      url.searchParams.append('q', params.q)
      if (params.sort) url.searchParams.append('sort', params.sort)
      if (params.order) url.searchParams.append('order', params.order)
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

    const items = data.items.map((item: any) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      html_url: item.html_url,
      repository: {
        full_name: item.repository.full_name,
        html_url: item.repository.html_url,
      },
    }))

    const content = `Found ${data.total_count} code result(s)${data.incomplete_results ? ' (incomplete)' : ''}:
${items
  .map(
    (item: any) =>
      `- ${item.repository.full_name}/${item.path}
  ${item.html_url}`
  )
  .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          total_count: data.total_count,
          incomplete_results: data.incomplete_results,
          items,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable search results' },
    metadata: {
      type: 'object',
      description: 'Search results metadata',
      properties: {
        total_count: { type: 'number', description: 'Total matching results' },
        incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
        items: {
          type: 'array',
          description: 'Array of code matches',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'File name' },
              path: { type: 'string', description: 'File path' },
              sha: { type: 'string', description: 'Blob SHA' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              repository: {
                type: 'object',
                description: 'Repository info',
                properties: {
                  full_name: { type: 'string', description: 'Repository full name' },
                  html_url: { type: 'string', description: 'Repository URL' },
                },
              },
            },
          },
        },
      },
    },
  },
}

export const searchCodeV2Tool: ToolConfig<SearchCodeParams, any> = {
  id: 'github_search_code_v2',
  name: searchCodeTool.name,
  description: searchCodeTool.description,
  version: '2.0.0',
  params: searchCodeTool.params,
  request: searchCodeTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        total_count: data.total_count,
        incomplete_results: data.incomplete_results,
        items: data.items.map((item: any) => ({
          ...item,
          text_matches: item.text_matches ?? [],
        })),
      },
    }
  },

  outputs: {
    total_count: { type: 'number', description: 'Total matching results' },
    incomplete_results: { type: 'boolean', description: 'Whether results are incomplete' },
    items: {
      type: 'array',
      description: 'Array of code matches from GitHub API',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name' },
          path: { type: 'string', description: 'File path' },
          sha: { type: 'string', description: 'Blob SHA' },
          url: { type: 'string', description: 'API URL' },
          git_url: { type: 'string', description: 'Git blob URL' },
          html_url: { type: 'string', description: 'GitHub web URL' },
          score: { type: 'number', description: 'Search relevance score' },
          repository: {
            type: 'object',
            description: 'Repository containing the code',
            properties: {
              id: { type: 'number', description: 'Repository ID' },
              node_id: { type: 'string', description: 'GraphQL node ID' },
              name: { type: 'string', description: 'Repository name' },
              full_name: { type: 'string', description: 'Full name (owner/repo)' },
              private: { type: 'boolean', description: 'Whether repository is private' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              description: {
                type: 'string',
                description: 'Repository description',
                optional: true,
              },
              fork: { type: 'boolean', description: 'Whether this is a fork' },
              url: { type: 'string', description: 'API URL' },
              owner: {
                type: 'object',
                description: 'Repository owner',
                properties: {
                  login: { type: 'string', description: 'Username' },
                  id: { type: 'number', description: 'User ID' },
                  node_id: { type: 'string', description: 'GraphQL node ID' },
                  avatar_url: { type: 'string', description: 'Avatar image URL' },
                  url: { type: 'string', description: 'API URL' },
                  html_url: { type: 'string', description: 'Profile page URL' },
                  type: { type: 'string', description: 'User or Organization' },
                  site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
                },
              },
            },
          },
          text_matches: {
            type: 'array',
            description: 'Text matches showing context',
            items: {
              type: 'object',
              properties: {
                object_url: { type: 'string', description: 'Object URL' },
                object_type: { type: 'string', description: 'Object type', optional: true },
                property: { type: 'string', description: 'Property matched' },
                fragment: { type: 'string', description: 'Text fragment with match' },
                matches: {
                  type: 'array',
                  description: 'Match indices',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string', description: 'Matched text' },
                      indices: { type: 'array', description: 'Start and end indices' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
