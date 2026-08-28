import type { OneDriveToolParams, OneDriveUploadResponse } from '@/tools/onedrive/types'
import type { InternalToolConfig } from '@/tools/types'

export const uploadTool: InternalToolConfig<OneDriveToolParams, OneDriveUploadResponse> = {
  id: 'onedrive_upload',
  name: 'Upload to OneDrive',
  description: 'Upload a file to OneDrive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the OneDrive API',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the file to upload (e.g., "report.pdf", "data.xlsx")',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'The file to upload (binary)',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The text content to upload (if no file is provided)',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The MIME type of the file to create (e.g., text/plain for .txt, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet for .xlsx)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Folder ID to upload the file to (e.g., "01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36M")',
    },
  },

  operation: {
    input: (params) => {
      return {
        accessToken: params.accessToken,
        fileName: params.fileName,
        file: params.file ?? null,
        content: params.content ?? null,
        folderId: params.folderId ?? null,
        mimeType: params.mimeType ?? null,
        values: params.values ?? null,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(data.error || 'Failed to upload file')
    return data
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the file was uploaded successfully' },
    file: {
      type: 'object',
      description:
        'The uploaded file object with metadata including id, name, webViewLink, webContentLink, and timestamps',
    },
  },
}
