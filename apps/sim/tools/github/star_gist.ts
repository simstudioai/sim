import type { ToolConfig } from '@/tools/types'

interface StarGistParams {
  gist_id: string
  apiKey: string
}

interface StarGistResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      starred: boolean
      gist_id: string
    }
  }
}

export const starGistTool: ToolConfig<StarGistParams, StarGistResponse> = {
  id: 'github_star_gist',
  name: 'GitHub Star Gist',
  description: 'Star a gist',
  version: '1.0.0',

  params: {
    gist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The gist ID to star',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/gists/${params.gist_id?.trim()}/star`,
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
          ? `Successfully starred gist ${params?.gist_id}`
          : `Failed to star gist ${params?.gist_id}`,
        metadata: {
          starred,
          gist_id: params?.gist_id ?? '',
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
        gist_id: { type: 'string', description: 'The gist ID' },
      },
    },
  },
}

export const starGistV2Tool: ToolConfig<StarGistParams, any> = {
  id: 'github_star_gist_v2',
  name: starGistTool.name,
  description: starGistTool.description,
  version: '2.0.0',
  params: starGistTool.params,
  request: starGistTool.request,

  transformResponse: async (response: Response, params) => {
    const starred = response.status === 204
    return {
      success: starred,
      output: {
        starred,
        gist_id: params?.gist_id ?? '',
      },
    }
  },

  outputs: {
    starred: { type: 'boolean', description: 'Whether starring succeeded' },
    gist_id: { type: 'string', description: 'The gist ID' },
  },
}
