import { createLogger } from '@sim/logger'
import type {
  ServiceNowListAttachmentsParams,
  ServiceNowListAttachmentsResponse,
} from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowListAttachmentsTool')

export const listAttachmentsTool: ToolConfig<
  ServiceNowListAttachmentsParams,
  ServiceNowListAttachmentsResponse
> = {
  id: 'servicenow_list_attachments',
  name: 'List ServiceNow Attachments',
  description: 'List the attachments on a ServiceNow record',
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
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table that owns the record (e.g., incident, change_request)',
    },
    recordSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id of the record whose attachments should be listed',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of attachments to return',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.instanceUrl.trim().replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }

      const queryParams = new URLSearchParams()
      queryParams.append(
        'sysparm_query',
        `table_name=${params.tableName.trim()}^table_sys_id=${params.recordSysId.trim()}`
      )
      if (params.limit) {
        queryParams.append('sysparm_limit', params.limit.toString())
      }

      return `${baseUrl}/api/now/attachment?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.username || !params.password) {
        throw new Error('ServiceNow username and password are required')
      }
      return {
        Authorization: createBasicAuthHeader(params.username, params.password),
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error || data
        throw new Error(typeof error === 'string' ? error : error.message || JSON.stringify(error))
      }

      const attachments = Array.isArray(data.result) ? data.result : []

      return {
        success: true,
        output: {
          attachments,
          metadata: {
            recordCount: attachments.length,
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow list attachments - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    attachments: {
      type: 'array',
      description: 'Attachment metadata records',
      items: {
        type: 'object',
        properties: {
          sys_id: { type: 'string', description: 'Attachment sys_id' },
          file_name: { type: 'string', description: 'File name' },
          content_type: { type: 'string', description: 'MIME type' },
          size_bytes: { type: 'string', description: 'File size in bytes' },
          download_link: { type: 'string', description: 'Direct download URL for the file' },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata (recordCount)',
    },
  },
}
