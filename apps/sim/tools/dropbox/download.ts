import type { DropboxDownloadParams, DropboxDownloadResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxDownloadTool: ToolConfig<DropboxDownloadParams, DropboxDownloadResponse> = {
  id: 'dropbox_download',
  name: 'Dropbox Download File',
  description: 'Download a file from Dropbox and get a temporary link',
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
      description: 'The path of the file to download (e.g., /folder/document.pdf)',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/get_temporary_link',
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
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to download file',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        file: data.metadata,
        content: '', // Content will be available via the temporary link
        temporaryLink: data.link,
      },
    }
  },

  outputs: {
    file: {
      type: 'object',
      description: 'The file metadata',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the file' },
        name: { type: 'string', description: 'Name of the file' },
        path_display: { type: 'string', description: 'Display path of the file' },
        size: { type: 'number', description: 'Size of the file in bytes' },
      },
    },
    temporaryLink: {
      type: 'string',
      description: 'Temporary link to download the file (valid for ~4 hours)',
    },
    content: {
      type: 'string',
      description: 'Base64 encoded file content (if fetched)',
    },
  },
}
