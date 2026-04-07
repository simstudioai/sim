import type { ToolConfig } from '@/tools/types'
import type { BoxDownloadFileParams, BoxDownloadFileResponse } from './types'

export const boxDownloadFileTool: ToolConfig<BoxDownloadFileParams, BoxDownloadFileResponse> = {
  id: 'box_download_file',
  name: 'Box Download File',
  description: 'Download a file from Box',
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
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to download',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId.trim()}/content`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (response.status === 202) {
      const retryAfter = response.headers.get('retry-after') || 'a few'
      throw new Error(`File is not yet ready for download. Retry after ${retryAfter} seconds.`)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Failed to download file: ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition')
    let fileName = 'download'

    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match?.[1]) {
        fileName = match[1].replace(/['"]/g, '')
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return {
      success: true,
      output: {
        file: {
          name: fileName,
          mimeType: contentType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        content: buffer.toString('base64'),
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
    },
    content: {
      type: 'string',
      description: 'Base64 encoded file content',
    },
  },
}
