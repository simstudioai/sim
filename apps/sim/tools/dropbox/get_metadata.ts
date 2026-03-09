import type { DropboxGetMetadataParams, DropboxGetMetadataResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxGetMetadataTool: ToolConfig<
  DropboxGetMetadataParams,
  DropboxGetMetadataResponse
> = {
  id: 'dropbox_get_metadata',
  name: 'Dropbox Get Metadata',
  description: 'Get metadata for a file or folder in Dropbox',
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
      description: 'The path of the file or folder to get metadata for',
    },
    includeMediaInfo: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, include media info for photos/videos',
    },
    includeDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, include deleted files in results',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/get_metadata',
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
      path: params.path,
      include_media_info: params.includeMediaInfo ?? false,
      include_deleted: params.includeDeleted ?? false,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to get metadata',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        metadata: data,
      },
    }
  },

  outputs: {
    metadata: {
      type: 'object',
      description: 'Metadata for the file or folder',
      properties: {
        '.tag': { type: 'string', description: 'Type: file, folder, or deleted' },
        id: { type: 'string', description: 'Unique identifier' },
        name: { type: 'string', description: 'Name of the item' },
        path_display: { type: 'string', description: 'Display path' },
        path_lower: { type: 'string', description: 'Lowercase path' },
        size: { type: 'number', description: 'Size in bytes (files only)' },
        client_modified: { type: 'string', description: 'Client modification time' },
        server_modified: { type: 'string', description: 'Server modification time' },
        rev: { type: 'string', description: 'Revision identifier' },
        content_hash: { type: 'string', description: 'Content hash' },
      },
    },
  },
}
