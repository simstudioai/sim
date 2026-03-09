import type { DropboxListFolderParams, DropboxListFolderResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxListFolderTool: ToolConfig<DropboxListFolderParams, DropboxListFolderResponse> =
  {
    id: 'dropbox_list_folder',
    name: 'Dropbox List Folder',
    description: 'List the contents of a folder in Dropbox',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'dropbox',
    },

    params: {
      path: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The path of the folder to list (use "" for root)',
      },
      recursive: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'If true, list contents recursively',
      },
      includeDeleted: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'If true, include deleted files/folders',
      },
      includeMediaInfo: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'If true, include media info for photos/videos',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of results to return (default: 500)',
      },
    },

    request: {
      url: 'https://api.dropboxapi.com/2/files/list_folder',
      method: 'POST',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Missing access token for Dropbox API request')
        }
        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        }
      },
      body: (params) => ({
        path: params.path === '/' ? '' : params.path,
        recursive: params.recursive ?? false,
        include_deleted: params.includeDeleted ?? false,
        include_media_info: params.includeMediaInfo ?? false,
        limit: params.limit,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error_summary || data.error?.message || 'Failed to list folder',
          output: {},
        }
      }

      return {
        success: true,
        output: {
          entries: data.entries,
          cursor: data.cursor,
          hasMore: data.has_more,
        },
      }
    },

    outputs: {
      entries: {
        type: 'array',
        description: 'List of files and folders in the directory',
        items: {
          type: 'object',
          properties: {
            '.tag': { type: 'string', description: 'Type: file, folder, or deleted' },
            id: { type: 'string', description: 'Unique identifier' },
            name: { type: 'string', description: 'Name of the file/folder' },
            path_display: { type: 'string', description: 'Display path' },
            size: { type: 'number', description: 'Size in bytes (files only)' },
          },
        },
      },
      cursor: {
        type: 'string',
        description: 'Cursor for pagination',
      },
      hasMore: {
        type: 'boolean',
        description: 'Whether there are more results',
      },
    },
  }
