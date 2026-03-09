import { GIST_FILES_OUTPUT, GIST_OUTPUT_PROPERTIES, GIST_OWNER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface ListGistsParams {
  username?: string
  since?: string
  per_page?: number
  page?: number
  apiKey: string
}

interface ListGistsResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      gists: Array<{
        id: string
        html_url: string
        description: string | null
        public: boolean
        created_at: string
        updated_at: string
        files: string[]
        owner: { login: string }
        comments: number
      }>
      count: number
    }
  }
}

export const listGistsTool: ToolConfig<ListGistsParams, ListGistsResponse> = {
  id: 'github_list_gists',
  name: 'GitHub List Gists',
  description: 'List gists for a user or the authenticated user',
  version: '1.0.0',

  params: {
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "GitHub username (omit for authenticated user's gists)",
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only gists updated after this time (ISO 8601)',
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
      const baseUrl = params.username
        ? `https://api.github.com/users/${params.username}/gists`
        : 'https://api.github.com/gists'
      const url = new URL(baseUrl)
      if (params.since) url.searchParams.append('since', params.since)
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

    const gists = data.map((g: any) => ({
      id: g.id,
      html_url: g.html_url,
      description: g.description ?? null,
      public: g.public,
      created_at: g.created_at,
      updated_at: g.updated_at,
      files: Object.keys(g.files ?? {}),
      owner: { login: g.owner?.login ?? 'unknown' },
      comments: g.comments ?? 0,
    }))

    const content = `Found ${gists.length} gist(s):
${gists
  .map(
    (g: any) =>
      `${g.id} - ${g.description ?? 'No description'} (${g.public ? 'public' : 'secret'})
  Files: ${g.files.join(', ')}
  ${g.html_url}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          gists,
          count: gists.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable gist list' },
    metadata: {
      type: 'object',
      description: 'Gists metadata',
      properties: {
        gists: {
          type: 'array',
          description: 'Array of gists',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Gist ID' },
              html_url: { type: 'string', description: 'Web URL' },
              description: { type: 'string', description: 'Description', optional: true },
              public: { type: 'boolean', description: 'Is public' },
              created_at: { type: 'string', description: 'Creation date' },
              updated_at: { type: 'string', description: 'Update date' },
              files: { type: 'array', description: 'File names' },
              owner: { type: 'object', description: 'Owner info' },
              comments: { type: 'number', description: 'Comment count' },
            },
          },
        },
        count: { type: 'number', description: 'Number of gists returned' },
      },
    },
  },
}

export const listGistsV2Tool: ToolConfig<ListGistsParams, any> = {
  id: 'github_list_gists_v2',
  name: listGistsTool.name,
  description: listGistsTool.description,
  version: '2.0.0',
  params: listGistsTool.params,
  request: listGistsTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        items: data.map((g: any) => ({
          ...g,
          description: g.description ?? null,
          files: g.files ?? {},
          comments: g.comments ?? 0,
        })),
        count: data.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of gist objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          ...GIST_OUTPUT_PROPERTIES,
          files: GIST_FILES_OUTPUT,
          owner: GIST_OWNER_OUTPUT,
        },
      },
    },
    count: { type: 'number', description: 'Number of gists returned' },
  },
}
