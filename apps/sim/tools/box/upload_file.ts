import type { ToolConfig } from '@/tools/types'
import type { BoxUploadFileParams, BoxUploadFileResponse } from './types'
import { UPLOAD_FILE_OUTPUT_PROPERTIES } from './types'

export const boxUploadFileTool: ToolConfig<BoxUploadFileParams, BoxUploadFileResponse> = {
  id: 'box_upload_file',
  name: 'Box Upload File',
  description: 'Upload a file to a Box folder',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
    parentFolderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the folder to upload the file to (use "0" for root)',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'The file to upload (UserFile object)',
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
      description: 'Optional filename override',
    },
  },

  request: {
    url: '/api/tools/box/upload',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      parentFolderId: params.parentFolderId,
      file: params.file,
      fileContent: params.fileContent,
      fileName: params.fileName,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to upload file')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: UPLOAD_FILE_OUTPUT_PROPERTIES,
}
