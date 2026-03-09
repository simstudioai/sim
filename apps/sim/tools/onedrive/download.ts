import type { OneDriveDownloadResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

export const downloadTool: ToolConfig<OneDriveToolParams, OneDriveDownloadResponse> = {
  id: 'onedrive_download',
  name: 'Download File from OneDrive',
  description: 'Download a file from OneDrive',
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
      description: 'The access token for the Microsoft Graph API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to download (e.g., "01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36M")',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override (e.g., "report.pdf", "data.xlsx")',
    },
  },

  request: {
    url: '/api/tools/onedrive/download',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      fileId: params.fileId,
      fileName: params.fileName,
    }),
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
  },
}
