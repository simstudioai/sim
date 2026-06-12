import type { DaytonaUploadFileParams, DaytonaUploadFileResponse } from '@/tools/daytona/types'
import type { ToolConfig } from '@/tools/types'

export const daytonaUploadFileTool: ToolConfig<DaytonaUploadFileParams, DaytonaUploadFileResponse> =
  {
    id: 'daytona_upload_file',
    name: 'Daytona Upload File',
    description: 'Upload a file to a Daytona sandbox',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Daytona API key',
      },
      sandboxId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the sandbox to upload the file to',
      },
      destinationPath: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Destination path in the sandbox (a trailing slash uploads into that directory using the file name)',
      },
      file: {
        type: 'file',
        required: false,
        visibility: 'user-or-llm',
        description: 'The file to upload',
      },
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
        description: 'Optional file name override',
      },
    },

    request: {
      url: '/api/tools/daytona/upload',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        apiKey: params.apiKey,
        sandboxId: params.sandboxId,
        destinationPath: params.destinationPath,
        file: params.file,
        fileContent: params.fileContent,
        fileName: params.fileName,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload file')
      }
      return {
        success: true,
        output: {
          uploadedPath: data.uploadedPath,
          name: data.name,
          size: data.size,
        },
      }
    },

    outputs: {
      uploadedPath: {
        type: 'string',
        description: 'Path of the uploaded file in the sandbox',
      },
      name: { type: 'string', description: 'Name of the uploaded file' },
      size: { type: 'number', description: 'Size of the uploaded file in bytes' },
    },
  }
