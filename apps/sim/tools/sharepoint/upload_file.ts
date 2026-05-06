import type { SharepointToolParams, SharepointUploadFileResponse } from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const uploadFileTool: ToolConfig<SharepointToolParams, SharepointUploadFileResponse> = {
  id: 'sharepoint_upload_file',
  name: 'Upload File to SharePoint',
  description: 'Upload files to a SharePoint document library',
  version: '1.0.0',

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
      visibility: 'user-or-llm',
      description:
        'The ID of the document library (drive). If not provided, uses default drive. Example: b!abc123def456',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional folder path within the document library. Example: /Documents/Subfolder or /Shared Documents/Reports',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional: override the uploaded file name. Example: report-2024.pdf',
    },
    files: {
      type: 'file[]',
      required: true,
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
        siteId: optionalTrim(params.siteId) || 'root',
        driveId: optionalTrim(params.driveId) || null,
        folderPath: optionalTrim(params.folderPath) || null,
        fileName: optionalTrim(params.fileName) || null,
        files: params.files || null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const output = data.output ?? {}
    return {
      success: Boolean(data.success),
      output: {
        uploadedFiles: output.uploadedFiles ?? [],
        fileCount: output.fileCount ?? 0,
        skippedFiles: output.skippedFiles ?? [],
        skippedCount: output.skippedCount ?? 0,
        errors: output.errors ?? [],
      },
      error: data.success ? undefined : data.error || 'Failed to upload files to SharePoint',
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
    skippedFiles: {
      type: 'array',
      description: 'Files that were skipped before upload',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name' },
          size: { type: 'number', description: 'File size in bytes' },
          limit: { type: 'number', description: 'Upload size limit in bytes' },
          reason: { type: 'string', description: 'Reason the file was skipped' },
        },
      },
    },
    skippedCount: {
      type: 'number',
      description: 'Number of files skipped',
    },
    errors: {
      type: 'array',
      description: 'Per-file upload errors',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name' },
          error: { type: 'string', description: 'Error message' },
          status: {
            type: 'number',
            description: 'HTTP status from Microsoft Graph',
            optional: true,
          },
        },
      },
    },
  },
}
