import type { InsForgeStorageListParams, InsForgeStorageListResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const storageListTool: ToolConfig<InsForgeStorageListParams, InsForgeStorageListResponse> = {
  id: 'insforge_storage_list',
  name: 'InsForge Storage List',
  description: 'List files in an InsForge storage bucket',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
    },
    bucket: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the storage bucket',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The folder path to list files from (default: root)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of files to return (default: 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of files to skip (for pagination)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/storage/v1/object/list/${params.bucket}`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.path) {
        body.prefix = params.path
      }

      if (params.limit) {
        body.limit = Number(params.limit)
      }

      if (params.offset) {
        body.offset = Number(params.offset)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge storage list response: ${parseError}`)
    }

    const fileCount = Array.isArray(data) ? data.length : 0

    return {
      success: true,
      output: {
        message: `Successfully listed ${fileCount} file${fileCount === 1 ? '' : 's'} from storage`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of file objects with metadata' },
  },
}
