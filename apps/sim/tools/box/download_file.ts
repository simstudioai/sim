import { omit } from '@sim/utils/object'
import type {
  BoxDownloadFileParams,
  BoxDownloadFileResponse,
  BoxDownloadFileV2Response,
} from '@/tools/box/types'
import type { ToolConfig, ToolFileData } from '@/tools/types'

async function transformDownloadResponse(response: Response) {
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
        data: buffer,
        size: buffer.length,
      },
    },
  }
}

export const boxDownloadFileTool = {
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
    const result = await transformDownloadResponse(response)
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
    content: {
      type: 'string',
      description: 'Base64 encoded file content',
    },
  },
} satisfies ToolConfig<BoxDownloadFileParams, BoxDownloadFileResponse>

export const boxDownloadFileV2Tool: ToolConfig<
  BoxDownloadFileParams,
  BoxDownloadFileV2Response<ToolFileData>
> = {
  ...boxDownloadFileTool,
  id: 'box_download_file_v2',
  version: '2.0.0',
  request: { ...boxDownloadFileTool.request, responseType: 'binary' },
  transformResponse: transformDownloadResponse,
  outputs: omit(boxDownloadFileTool.outputs, ['content']),
}
