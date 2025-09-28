import { createLogger } from '@/lib/logs/console/logger'
import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from '@/tools/google_drive/types'
import { GOOGLE_WORKSPACE_MIME_TYPES, SOURCE_MIME_TYPES } from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveUploadTool')

export const uploadTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_upload',
  name: 'Upload to Google Drive',
  description: 'Upload a file to Google Drive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
    additionalScopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content of the file to upload',
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
    url: 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const metadata: {
        name: string | undefined
        mimeType: string
        parents?: string[]
      } = {
        name: params.fileName, // Important: Always include the filename in metadata
        mimeType: params.mimeType || 'text/plain',
      }

      // Add parent folder if specified (prefer folderSelector over folderId)
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId && parentFolderId.trim() !== '') {
        metadata.parents = [parentFolderId]
      }

      return metadata
    },
  },

  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        logger.error('Failed to create file in Google Drive', {
          status: response.status,
          statusText: response.statusText,
          data,
        })
        throw new Error(data.error?.message || 'Failed to create file in Google Drive')
      }

      // Now upload content to the created file
      const fileId = data.id
      const requestedMimeType = params?.mimeType || 'text/plain'
      const authHeader =
        response.headers.get('Authorization') || `Bearer ${params?.accessToken || ''}`

      // Special handling for Google Sheets - use Sheets API to properly populate data
      let handledAsSheet = false
      if (requestedMimeType === 'application/vnd.google-apps.spreadsheet' && params?.content) {
        // Parse content if it's a JSON string
        let values: any = params.content
        if (typeof values === 'string') {
          try {
            values = JSON.parse(values)
          } catch (_error) {
            // Not valid JSON, keep as string for CSV upload
          }
        }

        // If we have valid array data, use Sheets API to populate it
        if (Array.isArray(values)) {
          logger.info('Populating Google Sheet with array data', {
            fileId,
            fileName: params?.fileName,
            rowCount: values.length,
          })

          const sheetsApiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/Sheet1?valueInputOption=USER_ENTERED`

          const sheetsResponse = await fetch(sheetsApiUrl, {
            method: 'PUT',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              majorDimension: 'ROWS',
              values: values,
            }),
          })

          if (!sheetsResponse.ok) {
            const sheetsError = await sheetsResponse.json()
            logger.error('Failed to populate Google Sheet with data', {
              status: sheetsResponse.status,
              statusText: sheetsResponse.statusText,
              error: sheetsError,
            })
            throw new Error(
              sheetsError.error?.message || 'Failed to populate Google Sheet with data'
            )
          }

          handledAsSheet = true
          logger.info('Successfully populated Google Sheet', {
            fileId,
            rowCount: values.length,
            columnCount: values[0]?.length || 0,
          })
        }
      }

      // For non-Google Sheets or non-array content, use original upload logic
      if (!handledAsSheet) {
        // For non-Google Sheets or empty content, use the original upload logic
        const uploadMimeType = GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)
          ? SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
          : requestedMimeType

        logger.info('Uploading content to file', {
          fileId,
          fileName: params?.fileName,
          requestedMimeType,
          uploadMimeType,
        })

        const uploadResponse = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: {
              Authorization: authHeader,
              'Content-Type': uploadMimeType,
            },
            body: params?.content || '',
          }
        )

        if (!uploadResponse.ok) {
          const uploadError = await uploadResponse.json()
          logger.error('Failed to upload content to file', {
            status: uploadResponse.status,
            statusText: uploadResponse.statusText,
            error: uploadError,
          })
          throw new Error(uploadError.error?.message || 'Failed to upload content to file')
        }
      }

      // For Google Workspace documents, update the name again to ensure it sticks after conversion
      if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
        logger.info('Updating file name to ensure it persists after conversion', {
          fileId,
          fileName: params?.fileName,
        })

        const updateNameResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: params?.fileName,
            }),
          }
        )

        if (!updateNameResponse.ok) {
          logger.warn('Failed to update filename after conversion, but content was uploaded', {
            status: updateNameResponse.status,
            statusText: updateNameResponse.statusText,
          })
        }
      }

      // Get the final file data
      const finalFileResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      )

      const finalFile = await finalFileResponse.json()

      return {
        success: true,
        output: {
          file: {
            id: finalFile.id,
            name: finalFile.name,
            mimeType: finalFile.mimeType,
            webViewLink: finalFile.webViewLink,
            webContentLink: finalFile.webContentLink,
            size: finalFile.size,
            createdTime: finalFile.createdTime,
            modifiedTime: finalFile.modifiedTime,
            parents: finalFile.parents,
          },
        },
      }
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
