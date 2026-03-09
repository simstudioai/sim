import type { DropboxUploadParams, DropboxUploadResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

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
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'The file to upload (UserFile object)',
    },
    // Legacy field for backwards compatibility - hidden from UI
    fileContent: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Legacy: base64 encoded file content',
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
    url: '/api/tools/dropbox/upload',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      path: params.path,
      file: params.file,
      fileContent: params.fileContent,
      fileName: params.fileName,
      mode: params.mode,
      autorename: params.autorename,
      mute: params.mute,
    }),
  },

  transformResponse: async (response): Promise<DropboxUploadResponse> => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        error: data.error || 'Failed to upload file',
        output: {},
      }
    }

    return {
      success: true,
      output: data.output,
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
