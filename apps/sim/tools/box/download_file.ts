import type { BoxDownloadFileParams, BoxDownloadFileResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxDownloadFileTool: ToolConfig<BoxDownloadFileParams, BoxDownloadFileResponse> = {
  id: 'box_download_file',
  name: 'Box Download File',
  description: 'Get the download URL for a file in Box',
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
      description: 'The ID of the file to download',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId}/content`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response, params) => {
    // Box returns a 302 redirect with the download URL
    // If we get a redirect, extract the location
    if (response.status === 302 || response.status === 301) {
      const downloadUrl = response.headers.get('location')
      if (downloadUrl) {
        return {
          success: true,
          output: {
            downloadUrl,
            fileId: params?.fileId,
          },
        }
      }
    }

    // If we get the content directly (some API implementations)
    if (response.ok) {
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const contentDisposition = response.headers.get('content-disposition')
      let fileName = 'download'

      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (match) {
          fileName = match[1].replace(/['"]/g, '')
        }
      }

      // For text-based content, we can return the content
      if (contentType.includes('text') || contentType.includes('json')) {
        const content = await response.text()
        return {
          success: true,
          output: {
            content,
            fileName,
            mimeType: contentType,
          },
        }
      }

      // For binary content, return info about the file
      return {
        success: true,
        output: {
          fileName,
          mimeType: contentType,
          message: 'Binary file content available. Use the download URL to retrieve the file.',
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || data.error_description || 'Failed to download file',
      output: {},
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'File content (for text files)',
      optional: true,
    },
    downloadUrl: {
      type: 'string',
      description: 'URL to download the file',
      optional: true,
    },
    fileName: {
      type: 'string',
      description: 'Name of the file',
      optional: true,
    },
    mimeType: {
      type: 'string',
      description: 'MIME type of the file',
      optional: true,
    },
  },
}
