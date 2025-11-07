import type { SupabaseStorageListParams, SupabaseStorageListResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageListTool: ToolConfig<SupabaseStorageListParams, SupabaseStorageListResponse> = {
  id: 'supabase_storage_list',
  name: 'Supabase Storage List',
  description: 'List files in a Supabase storage bucket',
  version: '1.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
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
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Column to sort by: name, created_at, updated_at (default: name)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc or desc (default: asc)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter files by name',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  request: {
    url: (params) => {
      return `https://${params.projectId}.supabase.co/storage/v1/object/list/${params.bucket}`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const payload: any = {
        prefix: params.path || '',
        limit: params.limit ? Number(params.limit) : 100,
        offset: params.offset ? Number(params.offset) : 0,
      }

      if (params.sortBy) {
        payload.sortBy = {
          column: params.sortBy,
          order: params.sortOrder || 'asc',
        }
      }

      if (params.search) {
        payload.search = params.search
      }

      return payload
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage list response: ${parseError}`)
    }

    const fileCount = Array.isArray(data) ? data.length : 0

    return {
      success: true,
      output: {
        message: `Successfully listed ${fileCount} file${fileCount === 1 ? '' : 's'}`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'array',
      description: 'Array of file objects with metadata',
    },
  },
}
