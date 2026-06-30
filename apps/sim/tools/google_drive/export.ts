import type { GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveExportParams extends GoogleDriveToolParams {
  fileId: string
  mimeType: string
  fileName?: string
}

interface GoogleDriveExportResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
    exportedMimeType: string
  }
}

export const exportTool: ToolConfig<GoogleDriveExportParams, GoogleDriveExportResponse> = {
  id: 'google_drive_export',
  name: 'Export Google Drive File',
  description:
    'Export a Google Workspace file (Docs, Sheets, Slides, Drawings) to a chosen format such as PDF, DOCX, XLSX, or CSV',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Drive API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Google Workspace file to export',
    },
    mimeType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target MIME type to export to (e.g. application/pdf, text/csv)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override for the exported file',
    },
  },

  request: {
    url: '/api/tools/google_drive/export',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      fileId: params.fileId,
      mimeType: params.mimeType,
      fileName: params.fileName,
    }),
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Exported file stored in execution files',
    },
    exportedMimeType: {
      type: 'string',
      description: 'The MIME type the file was exported to',
    },
  },
}
