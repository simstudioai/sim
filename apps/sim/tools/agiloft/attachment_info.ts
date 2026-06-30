import type {
  AgiloftAttachmentInfoParams,
  AgiloftAttachmentInfoResponse,
} from '@/tools/agiloft/types'
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
    url: () => '/api/tools/agiloft/attachment_info',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      recordId: params.recordId,
      fieldName: params.fieldName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output,
      ...(data.error ? { error: data.error } : {}),
    }
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
