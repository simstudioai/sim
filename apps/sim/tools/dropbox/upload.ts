import type { DropboxUploadParams, DropboxUploadResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Escapes non-ASCII characters in JSON string for HTTP header safety.
 * Dropbox API requires characters 0x7F and all non-ASCII to be escaped as \uXXXX.
 */
function httpHeaderSafeJson(value: object): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
  })
}

export const dropboxUploadTool: ToolConfig<DropboxUploadParams, DropboxUploadResponse> = {
  id: 'dropbox_upload',
  name: 'Dropbox Upload File',
  description: 'Upload a file to Dropbox',
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
      description:
        'The path in Dropbox where the file should be saved (e.g., /folder/document.pdf)',
    },
    fileContent: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The base64 encoded content of the file to upload',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename (used if path is a folder)',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Write mode: add (default) or overwrite',
    },
    autorename: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, rename the file if there is a conflict',
    },
    mute: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: "If true, don't notify the user about this upload",
    },
  },

  request: {
    url: 'https://content.dropboxapi.com/2/files/upload',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Dropbox API request')
      }

      const dropboxApiArg = {
        path: params.path,
        mode: params.mode || 'add',
        autorename: params.autorename ?? true,
        mute: params.mute ?? false,
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': httpHeaderSafeJson(dropboxApiArg),
      }
    },
    body: (params) => {
      // Decode base64 to raw binary bytes - Dropbox expects raw binary, not base64 text
      return Buffer.from(params.fileContent, 'base64')
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to upload file',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        file: data,
      },
    }
  },

  outputs: {
    file: {
      type: 'object',
      description: 'The uploaded file metadata',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the file' },
        name: { type: 'string', description: 'Name of the file' },
        path_display: { type: 'string', description: 'Display path of the file' },
        path_lower: { type: 'string', description: 'Lowercase path of the file' },
        size: { type: 'number', description: 'Size of the file in bytes' },
        client_modified: { type: 'string', description: 'Client modification time' },
        server_modified: { type: 'string', description: 'Server modification time' },
        rev: { type: 'string', description: 'Revision identifier' },
        content_hash: { type: 'string', description: 'Content hash for the file' },
      },
    },
  },
}
