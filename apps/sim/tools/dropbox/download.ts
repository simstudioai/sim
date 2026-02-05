import { httpHeaderSafeJson } from '@/lib/core/utils/validation'
import type { DropboxDownloadParams, DropboxDownloadResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxDownloadTool: ToolConfig<DropboxDownloadParams, DropboxDownloadResponse> = {
  id: 'dropbox_download',
  name: 'Dropbox Download File',
  description: 'Download a file from Dropbox with metadata and content',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path of the file to download (e.g., /folder/document.pdf)',
    },
  },

  request: {
    url: 'https://content.dropboxapi.com/2/files/download',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Dropbox API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': httpHeaderSafeJson({ path: params.path }),
      }
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: errorText || 'Failed to download file',
        output: {},
      }
    }

    const apiResultHeader =
      response.headers.get('dropbox-api-result') || response.headers.get('Dropbox-API-Result')
    const metadata = apiResultHeader ? JSON.parse(apiResultHeader) : undefined
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const resolvedName = metadata?.name || params?.path?.split('/').pop() || 'download'

    let temporaryLink: string | undefined
    if (params?.accessToken) {
      try {
        const linkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: params.path }),
        })
        if (linkResponse.ok) {
          const linkData = await linkResponse.json()
          temporaryLink = linkData.link
        }
      } catch {
        temporaryLink = undefined
      }
    }

    return {
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType: contentType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        content: buffer.toString('base64'),
        metadata,
        temporaryLink,
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
    },
    metadata: {
      type: 'json',
      description: 'The file metadata',
    },
    temporaryLink: {
      type: 'string',
      description: 'Temporary link to download the file (valid for ~4 hours)',
    },
    content: {
      type: 'string',
      description: 'Base64 encoded file content (if fetched)',
    },
  },
}
