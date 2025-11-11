import type { SharepointToolParams, SharepointUploadFileResponse } from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

export const uploadFileTool: ToolConfig<SharepointToolParams, SharepointUploadFileResponse> = {
  id: 'sharepoint_upload_file',
  name: 'Upload File to SharePoint',
  description: 'Upload files to a SharePoint document library',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    siteId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the SharePoint site',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The ID of the document library (drive). If not provided, uses default drive.',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional folder path within the document library (e.g., /Documents/Subfolder)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional: override the uploaded file name',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to upload to SharePoint',
    },
  },

  request: {
    url: '/api/tools/sharepoint/upload',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SharepointToolParams) => {
      return {
        accessToken: params.accessToken,
        siteId: params.siteId || 'root',
        driveId: params.driveId || null,
        folderPath: params.folderPath || null,
        fileName: params.fileName || null,
        files: params.files || null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to upload files to SharePoint')
    }
    return {
      success: true,
      output: {
        uploadedFiles: data.output.uploadedFiles,
        fileCount: data.output.fileCount,
      },
    }
  },

  outputs: {
    uploadedFiles: {
      type: 'array',
      description: 'Array of uploaded file objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The unique ID of the uploaded file' },
          name: { type: 'string', description: 'The name of the uploaded file' },
          webUrl: { type: 'string', description: 'The URL to access the file' },
          size: { type: 'number', description: 'The size of the file in bytes' },
          createdDateTime: { type: 'string', description: 'When the file was created' },
          lastModifiedDateTime: { type: 'string', description: 'When the file was last modified' },
        },
      },
    },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded',
    },
  },
}
