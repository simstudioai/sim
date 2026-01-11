import type {
  InsForgeStorageDeleteParams,
  InsForgeStorageDeleteResponse,
} from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const storageDeleteTool: ToolConfig<
  InsForgeStorageDeleteParams,
  InsForgeStorageDeleteResponse
> = {
  id: 'insforge_storage_delete',
  name: 'InsForge Storage Delete',
  description: 'Delete files from an InsForge storage bucket',
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
    paths: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of file paths to delete (e.g., ["folder/file1.jpg", "folder/file2.jpg"])',
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
      return `${base}/storage/v1/object/${params.bucket}`
    },
    method: 'DELETE',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        prefixes: params.paths,
      }
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge storage delete response: ${parseError}`)
    }

    const deletedCount = Array.isArray(data) ? data.length : 0

    return {
      success: true,
      output: {
        message: `Successfully deleted ${deletedCount} file${deletedCount === 1 ? '' : 's'} from storage`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of deleted file objects' },
  },
}
