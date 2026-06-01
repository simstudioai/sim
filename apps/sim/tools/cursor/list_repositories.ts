import type { ListRepositoriesParams, ListRepositoriesResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const listRepositoriesBase = {
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
  },
  request: {
    url: () => 'https://api.cursor.com/v0/repositories',
    method: 'GET',
    headers: (params: ListRepositoriesParams) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },
} satisfies Pick<ToolConfig<ListRepositoriesParams, any>, 'params' | 'request'>

export const listRepositoriesTool: ToolConfig<ListRepositoriesParams, ListRepositoriesResponse> = {
  id: 'cursor_list_repositories',
  name: 'Cursor List Repositories',
  description: 'List the GitHub repositories accessible to the authenticated user.',
  version: '1.0.0',

  ...listRepositoriesBase,

  transformResponse: async (response) => {
    const data = await response.json()
    const repositories = data.repositories ?? []

    return {
      success: true,
      output: {
        content: `Found ${repositories.length} repository(ies)`,
        metadata: {
          repositories,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable repository count' },
    metadata: {
      type: 'object',
      description: 'Repositories metadata',
      properties: {
        repositories: {
          type: 'array',
          description: 'Array of accessible repositories',
          items: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'Repository owner' },
              name: { type: 'string', description: 'Repository name' },
              repository: { type: 'string', description: 'Repository URL' },
            },
          },
        },
      },
    },
  },
}

interface ListRepositoriesV2Response {
  success: boolean
  output: {
    repositories: Array<{ owner: string; name: string; repository: string }>
  }
}

export const listRepositoriesV2Tool: ToolConfig<
  ListRepositoriesParams,
  ListRepositoriesV2Response
> = {
  ...listRepositoriesBase,
  id: 'cursor_list_repositories_v2',
  name: 'Cursor List Repositories',
  description:
    'List the GitHub repositories accessible to the authenticated user. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        repositories: Array.isArray(data.repositories) ? data.repositories : [],
      },
    }
  },
  outputs: {
    repositories: {
      type: 'array',
      description: 'Array of accessible repositories',
      items: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          name: { type: 'string', description: 'Repository name' },
          repository: { type: 'string', description: 'Repository URL' },
        },
      },
    },
  },
}
