import type { DaytonaDownloadFileParams, DaytonaDownloadFileResponse } from '@/tools/daytona/types'
import { daytonaToolboxUrl, extractDaytonaError } from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024

function downloadSizeError(bytes: number): Error {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  return new Error(`File size (${sizeMB}MB) exceeds download limit of 100MB`)
}

export const daytonaDownloadFileTool: ToolConfig<
  DaytonaDownloadFileParams,
  DaytonaDownloadFileResponse
> = {
  id: 'daytona_download_file',
  name: 'Daytona Download File',
  description: 'Download a file from a Daytona sandbox',
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
      description: 'ID of the sandbox to download the file from',
    },
    filePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path of the file in the sandbox',
    },
  },

  request: {
    url: (params) =>
      daytonaToolboxUrl(
        params.sandboxId,
        `/files/download?path=${encodeURIComponent(params.filePath.trim())}`
      ),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to download file'))
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_SIZE_BYTES) {
      throw downloadSizeError(contentLength)
    }

    const mimeType = response.headers.get('content-type') || 'application/octet-stream'
    const fileName = params?.filePath.trim().split('/').filter(Boolean).pop() || 'download'
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length > MAX_DOWNLOAD_SIZE_BYTES) {
      throw downloadSizeError(buffer.length)
    }

    return {
      success: true,
      output: {
        file: {
          name: fileName,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        name: fileName,
        mimeType,
        size: buffer.length,
      },
    }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    name: { type: 'string', description: 'Name of the downloaded file' },
    mimeType: { type: 'string', description: 'MIME type of the downloaded file' },
    size: { type: 'number', description: 'Size of the downloaded file in bytes' },
  },
}
