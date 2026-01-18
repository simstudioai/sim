import type { ToolConfig } from '@/tools/types'

interface UnstarGistParams {
  gist_id: string
  apiKey: string
}

interface UnstarGistResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      unstarred: boolean
      gist_id: string
    }
  }
}

export const unstarGistTool: ToolConfig<UnstarGistParams, UnstarGistResponse> = {
  id: 'github_unstar_gist',
  name: 'GitHub Unstar Gist',
  description: 'Unstar a gist',
  version: '1.0.0',

  params: {
    gist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The gist ID to unstar',
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
          ? `Successfully unstarred gist ${params?.gist_id}`
          : `Failed to unstar gist ${params?.gist_id}`,
        metadata: {
          unstarred,
          gist_id: params?.gist_id ?? '',
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
        gist_id: { type: 'string', description: 'The gist ID' },
      },
    },
  },
}

export const unstarGistV2Tool: ToolConfig<UnstarGistParams, any> = {
  id: 'github_unstar_gist_v2',
  name: unstarGistTool.name,
  description: unstarGistTool.description,
  version: '2.0.0',
  params: unstarGistTool.params,
  request: unstarGistTool.request,

  transformResponse: async (response: Response, params) => {
    const unstarred = response.status === 204
    return {
      success: unstarred,
      output: {
        unstarred,
        gist_id: params?.gist_id ?? '',
      },
    }
  },

  outputs: {
    unstarred: { type: 'boolean', description: 'Whether unstarring succeeded' },
    gist_id: { type: 'string', description: 'The gist ID' },
  },
}
