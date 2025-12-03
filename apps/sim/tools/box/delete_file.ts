import type { BoxDeleteFileParams, BoxDeleteFileResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxDeleteFileTool: ToolConfig<BoxDeleteFileParams, BoxDeleteFileResponse> = {
  id: 'box_delete_file',
  name: 'Box Delete File',
  description:
    'Delete a file from Box. Standard delete moves to trash. Use permanent flag for files already in trash.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to delete',
    },
    permanent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, permanently delete a file that is already in trash',
    },
  },

  request: {
    url: (params) => {
      // Standard delete always moves file to trash
      // To permanently delete, the file must already be in trash (use /files/{id}/trash endpoint)
      // The permanent flag here deletes from trash if the file is already there
      if (params.permanent) {
        return `https://api.box.com/2.0/files/${params.fileId}/trash`
      }
      return `https://api.box.com/2.0/files/${params.fileId}`
    },
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response, params) => {
    if (response.status === 204) {
      return {
        success: true,
        output: {
          success: true,
          fileId: params?.fileId,
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || data.error_description || 'Failed to delete file',
      output: {},
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the file was successfully deleted',
    },
    fileId: {
      type: 'string',
      description: 'The ID of the deleted file',
    },
  },
}
