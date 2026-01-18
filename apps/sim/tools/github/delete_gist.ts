import type { ToolConfig } from '@/tools/types'

interface DeleteGistParams {
  gist_id: string
  apiKey: string
}

interface DeleteGistResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      deleted: boolean
      gist_id: string
    }
  }
}

export const deleteGistTool: ToolConfig<DeleteGistParams, DeleteGistResponse> = {
  id: 'github_delete_gist',
  name: 'GitHub Delete Gist',
  description: 'Delete a gist by ID',
  version: '1.0.0',

  params: {
    gist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The gist ID to delete',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/gists/${params.gist_id?.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const deleted = response.status === 204

    return {
      success: deleted,
      output: {
        content: deleted
          ? `Successfully deleted gist ${params?.gist_id}`
          : `Failed to delete gist ${params?.gist_id}`,
        metadata: {
          deleted,
          gist_id: params?.gist_id ?? '',
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Delete operation metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
        gist_id: { type: 'string', description: 'The deleted gist ID' },
      },
    },
  },
}

export const deleteGistV2Tool: ToolConfig<DeleteGistParams, any> = {
  id: 'github_delete_gist_v2',
  name: deleteGistTool.name,
  description: deleteGistTool.description,
  version: '2.0.0',
  params: deleteGistTool.params,
  request: deleteGistTool.request,

  transformResponse: async (response: Response, params) => {
    const deleted = response.status === 204
    return {
      success: deleted,
      output: {
        deleted,
        gist_id: params?.gist_id ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
    gist_id: { type: 'string', description: 'The deleted gist ID' },
  },
}
