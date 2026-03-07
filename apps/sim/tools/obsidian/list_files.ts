import type { ToolConfig } from '@/tools/types'
import type { ObsidianListFilesParams, ObsidianListFilesResponse } from './types'

export const listFilesTool: ToolConfig<ObsidianListFilesParams, ObsidianListFilesResponse> = {
  id: 'obsidian_list_files',
  name: 'Obsidian List Files',
  description: 'List files and directories in your Obsidian vault',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key from Obsidian Local REST API plugin settings',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL for the Obsidian Local REST API',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Directory path relative to vault root. Leave empty to list root.',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      const path = params.path
        ? `/${params.path.trim().split('/').map(encodeURIComponent).join('/')}/`
        : '/'
      return `${base}/vault${path}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to list files: ${error.message ?? response.statusText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        files:
          data.files?.map((f: string | { path: string; type: string }) => {
            if (typeof f === 'string') {
              return { path: f, type: f.endsWith('/') ? 'directory' : 'file' }
            }
            return { path: f.path ?? '', type: f.type ?? 'file' }
          }) ?? [],
      },
    }
  },

  outputs: {
    files: {
      type: 'json',
      description: 'List of files and directories',
      properties: {
        path: { type: 'string', description: 'File or directory path' },
        type: { type: 'string', description: 'Whether the entry is a file or directory' },
      },
    },
  },
}
