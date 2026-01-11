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
  description: 'Delete a file from an InsForge storage bucket',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The file path to delete (e.g., "folder/file.jpg")',
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
      return `${base}/api/storage/buckets/${params.bucket}/objects/${params.path}`
    },
    method: 'DELETE',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      const text = await response.text()
      if (text?.trim()) {
        try {
          data = JSON.parse(text)
        } catch {
          data = { result: text }
        }
      } else {
        data = {}
      }
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge storage delete response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully deleted file from storage',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'json', description: 'Delete operation result' },
  },
}
