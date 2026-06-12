import type { DaytonaListFilesParams, DaytonaListFilesResponse } from '@/tools/daytona/types'
import { daytonaToolboxUrl, extractDaytonaError } from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

export const daytonaListFilesTool: ToolConfig<DaytonaListFilesParams, DaytonaListFilesResponse> = {
  id: 'daytona_list_files',
  name: 'Daytona List Files',
  description: 'List files in a directory of a Daytona sandbox',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Daytona API key',
    },
    sandboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the sandbox to list files in',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Directory path to list (defaults to the sandbox working directory)',
    },
  },

  request: {
    url: (params) => {
      const query = params.path ? `?path=${encodeURIComponent(params.path.trim())}` : ''
      return daytonaToolboxUrl(params.sandboxId, `/files${query}`)
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to list files'))
    }
    const data = await response.json()
    const files = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        files: files.map((file: Record<string, any>) => ({
          name: file.name ?? '',
          isDir: file.isDir ?? false,
          size: file.size ?? 0,
          mode: file.mode ?? '',
          permissions: file.permissions ?? '',
          owner: file.owner ?? '',
          group: file.group ?? '',
          modifiedAt: file.modifiedAt ?? '',
        })),
      },
    }
  },

  outputs: {
    files: {
      type: 'array',
      description: 'Files and directories at the given path',
      items: {
        type: 'json',
        properties: {
          name: { type: 'string', description: 'File or directory name' },
          isDir: { type: 'boolean', description: 'Whether the entry is a directory' },
          size: { type: 'number', description: 'Size in bytes' },
          mode: { type: 'string', description: 'File mode string' },
          permissions: { type: 'string', description: 'Permission string' },
          owner: { type: 'string', description: 'Owning user' },
          group: { type: 'string', description: 'Owning group' },
          modifiedAt: { type: 'string', description: 'Last modification timestamp' },
        },
      },
    },
  },
}
