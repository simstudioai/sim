import type { DropboxRestoreParams, DropboxRestoreResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxRestoreTool: ToolConfig<DropboxRestoreParams, DropboxRestoreResponse> = {
  id: 'dropbox_restore',
  name: 'Dropbox Restore',
  description: 'Restore a specific revision of a file to the given path',
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
      description: 'The path to save the restored file to',
    },
    rev: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The revision identifier to restore (from Dropbox List Revisions)',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/restore',
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
      path: params.path.trim(),
      rev: params.rev.trim(),
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to restore file',
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
      description: 'Metadata of the restored file',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the file' },
        name: { type: 'string', description: 'Name of the file' },
        path_display: { type: 'string', description: 'Display path of the file', optional: true },
        path_lower: { type: 'string', description: 'Lowercase path of the file', optional: true },
        size: { type: 'number', description: 'Size of the file in bytes' },
        rev: { type: 'string', description: 'Revision identifier of the restored file' },
        server_modified: { type: 'string', description: 'Server modification time' },
      },
    },
  },
}
