import type {
  AgiloftAttachmentInfoParams,
  AgiloftAttachmentInfoResponse,
} from '@/tools/agiloft/types'
import { buildAttachmentInfoUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftAttachmentInfoTool: ToolConfig<
  AgiloftAttachmentInfoParams,
  AgiloftAttachmentInfoResponse
> = {
  id: 'agiloft_attachment_info',
  name: 'Agiloft Attachment Info',
  description: 'Get information about file attachments on a record field.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
    },
    knowledgeBase: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name (e.g., "contracts")',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the record to check attachments on',
    },
    fieldName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the attachment field to inspect',
    },
  },

  request: {
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftAttachmentInfoResponse>(
      params,
      (base) => ({
        url: buildAttachmentInfoUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { attachments: [], totalCount: 0 },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = await response.json()
        const result = data.result ?? data

        const attachments: Array<{ position: number; name: string; size: number }> = []

        if (Array.isArray(result)) {
          for (let i = 0; i < result.length; i++) {
            const item = result[i]
            attachments.push({
              position: item.position ?? i,
              name: item.name ?? item.filename ?? '',
              size: item.size ?? 0,
            })
          }
        }

        return {
          success: data.success !== false,
          output: {
            attachments,
            totalCount: attachments.length,
          },
        }
      }
    )
  },

  outputs: {
    attachments: {
      type: 'array',
      description: 'List of attachments with position, name, and size',
      items: {
        type: 'object',
        properties: {
          position: {
            type: 'number',
            description: 'Position index of the attachment in the field',
          },
          name: { type: 'string', description: 'File name of the attachment' },
          size: { type: 'number', description: 'File size in bytes' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of attachments in the field',
    },
  },
}
