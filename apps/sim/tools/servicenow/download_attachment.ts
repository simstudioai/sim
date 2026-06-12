import { createLogger } from '@sim/logger'
import type {
  ServiceNowDownloadAttachmentParams,
  ServiceNowDownloadAttachmentResponse,
} from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowDownloadAttachmentTool')

export const downloadAttachmentTool: ToolConfig<
  ServiceNowDownloadAttachmentParams,
  ServiceNowDownloadAttachmentResponse
> = {
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
      const baseUrl = params.instanceUrl.trim().replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      return `${baseUrl}/api/now/attachment/${params.attachmentSysId.trim()}/file`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.username || !params.password) {
        throw new Error('ServiceNow username and password are required')
      }
      return {
        Authorization: createBasicAuthHeader(params.username, params.password),
        Accept: '*/*',
      }
    },
  },

  transformResponse: async (response: Response) => {
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
      description: 'Downloaded attachment stored in execution files',
    },
    content: {
      type: 'string',
      description: 'Base64 encoded file content',
    },
  },
}
