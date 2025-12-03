import { createLogger } from '@/lib/logs/console/logger'
import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from '@/tools/google_drive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveUploadFileTool')

export const uploadFileTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_upload_file',
  name: 'Upload File',
  description: 'Upload a binary file (UserFile or raw) to Google Drive',
  version: '1.0',

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
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the file to upload',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'File object (UserFile) from previous block to upload',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type of the file to upload',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the folder to upload the file to',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to upload the file to (internal use)',
    },
  },

  request: {
    url: () => '/api/tools/google_drive/uploadFile',
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleDriveToolParams) => {
      return {
        accessToken: params.accessToken,
        fileName: params.fileName,
        file: params.file,
        mimeType: params.mimeType,
        folderSelector: params.folderSelector,
        folderId: params.folderId,
      }
    },
  },

  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        logger.error('Failed to upload file to Google Drive', {
          status: response.status,
          statusText: response.statusText,
          data,
        })
        throw new Error(
          data.error?.message || data.error || 'Failed to upload file to Google Drive'
        )
      }

      // The internal API route already handles all the upload logic
      return data
    } catch (error: any) {
      logger.error('Error in upload transformation', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  },

  outputs: {
    file: { type: 'json', description: 'Uploaded file metadata including ID, name, and links' },
  },
}
