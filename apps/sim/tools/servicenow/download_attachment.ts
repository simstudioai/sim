import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import type {
  ServiceNowDownloadAttachmentParams,
  ServiceNowDownloadAttachmentResponse,
  ServiceNowDownloadAttachmentV2Response,
} from '@/tools/servicenow/types'
import { buildServiceNowHeaders, normalizeInstanceUrl } from '@/tools/servicenow/utils'
import type { ToolConfig, ToolFileData } from '@/tools/types'

const logger = createLogger('ServiceNowDownloadAttachmentTool')

async function transformDownloadResponse(response: Response) {
  if (!response.ok) {
    const errorText = await response.text()
    logger.error('ServiceNow download attachment - request failed', {
      status: response.status,
      errorText,
    })
    throw new Error(errorText || `Failed to download attachment: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const contentDisposition = response.headers.get('content-disposition')
  let fileName = 'attachment'

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

export const downloadAttachmentTool = {
  id: 'servicenow_download_attachment',
  name: 'Download ServiceNow Attachment',
  description: 'Download an attachment file from ServiceNow by its sys_id',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow instance URL (e.g., https://instance.service-now.com)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow password',
    },
    attachmentSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id of the attachment to download (from List Attachments)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      return `${baseUrl}/api/now/attachment/${params.attachmentSysId.trim()}/file`
    },
    method: 'GET',
    headers: (params) => ({
      ...buildServiceNowHeaders(params),
      Accept: '*/*',
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
      description: 'Downloaded attachment stored in execution files',
    },
    content: {
      type: 'string',
      description: 'Base64 encoded file content',
    },
  },
} satisfies ToolConfig<ServiceNowDownloadAttachmentParams, ServiceNowDownloadAttachmentResponse>

export const downloadAttachmentV2Tool: ToolConfig<
  ServiceNowDownloadAttachmentParams,
  ServiceNowDownloadAttachmentV2Response<ToolFileData>
> = {
  ...downloadAttachmentTool,
  id: 'servicenow_download_attachment_v2',
  version: '2.0.0',
  request: { ...downloadAttachmentTool.request, responseType: 'binary' },
  transformResponse: transformDownloadResponse,
  outputs: omit(downloadAttachmentTool.outputs, ['content']),
}
