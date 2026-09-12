import { omit } from '@sim/utils/object'
import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import { httpHeaderSafeJson } from '@/lib/core/utils/validation'
import type {
  DropboxDownloadParams,
  DropboxDownloadResponse,
  DropboxDownloadV2Response,
} from '@/tools/dropbox/types'
import type { ToolConfig, ToolFileData } from '@/tools/types'

const { fetch: providerFetch } = createSsrfGuardedFetchWithDispatcher({
  profile: 'configuredEndpoint',
})

async function transformDownloadResponse(response: Response, params?: DropboxDownloadParams) {
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
      const linkResponse = await providerFetch(
        'https://api.dropboxapi.com/2/files/get_temporary_link',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: params.path.trim() }),
        }
      )
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
        data: buffer,
        size: buffer.length,
      },
      metadata,
      temporaryLink,
    },
  }
}

export const dropboxDownloadTool = {
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
        'Dropbox-API-Arg': httpHeaderSafeJson({ path: params.path.trim() }),
      }
    },
  },

  transformResponse: async (response, params) => {
    const result = await transformDownloadResponse(response, params)
    if (!result.success || !result.output.file) return result
    const file = result.output.file
    const content = file.data.toString('base64')
    return {
      ...result,
      output: {
        ...result.output,
        file: { ...file, data: content },
        content,
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
} satisfies ToolConfig<DropboxDownloadParams, DropboxDownloadResponse>

export const dropboxDownloadV2Tool: ToolConfig<
  DropboxDownloadParams,
  DropboxDownloadV2Response<ToolFileData>
> = {
  ...dropboxDownloadTool,
  id: 'dropbox_download_v2',
  description: 'Download a file from Dropbox with metadata',
  version: '2.0.0',
  request: { ...dropboxDownloadTool.request, responseType: 'binary' },
  transformResponse: transformDownloadResponse,
  outputs: omit(dropboxDownloadTool.outputs, ['content']),
}
