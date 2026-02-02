import { createLogger } from '@sim/logger'
import type { OneDriveToolParams, OneDriveUploadResponse } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OneDriveUploadTool')

export const uploadTool: ToolConfig<OneDriveToolParams, OneDriveUploadResponse> = {
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
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Folder ID to upload the file to (e.g., "01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36M")',
    },
    manualFolderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Manually entered folder ID (advanced mode)',
    },
  },

  request: {
    url: (params) => {
      const isExcelFile =
        params.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      if (params.file || isExcelFile) {
        return '/api/tools/onedrive/upload'
      }

      let fileName = params.fileName || 'untitled'

      if (!fileName.endsWith('.txt')) {
        fileName = `${fileName.replace(/\.[^.]*$/, '')}.txt`
      }

      const parentFolderId = params.manualFolderId || params.folderSelector
      if (parentFolderId && parentFolderId.trim() !== '') {
        return `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentFolderId)}:/${fileName}:/content`
      }
      return `https://graph.microsoft.com/v1.0/me/drive/root:/${fileName}:/content`
    },
    method: (params) => {
      const isExcelFile =
        params.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      return params.file || isExcelFile ? 'POST' : 'PUT'
    },
    headers: (params) => {
      const headers: Record<string, string> = {}
      const isExcelFile =
        params.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

      if (params.file || isExcelFile) {
        headers['Content-Type'] = 'application/json'
      } else {
        headers.Authorization = `Bearer ${params.accessToken}`
        headers['Content-Type'] = 'text/plain'
      }
      return headers
    },
    body: (params) => {
      const isExcelFile =
        params.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

      if (params.file || isExcelFile) {
        return {
          accessToken: params.accessToken,
          fileName: params.fileName,
          file: params.file,
          folderId: params.manualFolderId || params.folderSelector,
          ...(params.mimeType && { mimeType: params.mimeType }),
          ...(params.values && { values: params.values }),
        }
      }

      return (params.content || '') as unknown as Record<string, unknown>
    },
  },

  transformResponse: async (response: Response, params?: OneDriveToolParams) => {
    const data = await response.json()

    const isExcelFile =
      params?.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    if ((params?.file || isExcelFile) && data.success !== undefined) {
      if (!data.success) {
        throw new Error(data.error || 'Failed to upload file')
      }

      logger.info('Successfully uploaded file to OneDrive via custom API', {
        fileId: data.output?.file?.id,
        fileName: data.output?.file?.name,
      })

      return {
        success: true,
        output: data.output,
      }
    }

    const fileData = data

    logger.info('Successfully uploaded file to OneDrive', {
      fileId: fileData.id,
      fileName: fileData.name,
    })

    return {
      success: true,
      output: {
        file: {
          id: fileData.id,
          name: fileData.name,
          mimeType: fileData.file?.mimeType || params?.mimeType || 'text/plain',
          webViewLink: fileData.webUrl,
          webContentLink: fileData['@microsoft.graph.downloadUrl'],
          size: fileData.size,
          createdTime: fileData.createdDateTime,
          modifiedTime: fileData.lastModifiedDateTime,
          parentReference: fileData.parentReference,
        },
      },
    }
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
