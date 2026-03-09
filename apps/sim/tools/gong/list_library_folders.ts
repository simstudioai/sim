import type {
  GongListLibraryFoldersParams,
  GongListLibraryFoldersResponse,
} from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listLibraryFoldersTool: ToolConfig<
  GongListLibraryFoldersParams,
  GongListLibraryFoldersResponse
> = {
  id: 'gong_list_library_folders',
  name: 'Gong List Library Folders',
  description: 'Retrieve library folders from Gong.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Gong workspace ID to filter folders',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/library/folders')
      if (params.workspaceId) url.searchParams.set('workspaceId', params.workspaceId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list library folders')
    }
    const folders = (data.folders ?? []).map((f: Record<string, unknown>) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      parentFolderId: f.parentFolderId ?? null,
      createdBy: f.createdBy ?? null,
      updated: f.updated ?? null,
    }))
    return {
      success: true,
      output: { folders },
    }
  },

  outputs: {
    folders: {
      type: 'array',
      description: 'List of library folders with id, name, and parent relationships',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Gong unique numeric identifier for the folder' },
          name: { type: 'string', description: 'Display name of the folder' },
          parentFolderId: {
            type: 'string',
            description:
              'Gong unique numeric identifier for the parent folder (null for root folder)',
          },
          createdBy: {
            type: 'string',
            description: 'Gong unique numeric identifier for the user who added the folder',
          },
          updated: {
            type: 'string',
            description: "Folder's last update time in ISO-8601 format",
          },
        },
      },
    },
  },
}
