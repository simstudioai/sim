import type {
  AgiloftRemoveAttachmentParams,
  AgiloftRemoveAttachmentResponse,
} from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftRemoveAttachmentTool: ToolConfig<
  AgiloftRemoveAttachmentParams,
  AgiloftRemoveAttachmentResponse
> = {
  id: 'agiloft_remove_attachment',
  name: 'Agiloft Remove Attachment',
  description: 'Remove an attached file from a field in an Agiloft record.',
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
      description: 'ID of the record containing the attachment',
    },
    fieldName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the attachment field',
    },
    position: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Position index of the file to remove (starting from 0)',
    },
  },

  request: {
    url: () => '/api/tools/agiloft/remove_attachment',
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
      position: params.position,
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
    recordId: {
      type: 'string',
      description: 'ID of the record',
    },
    fieldName: {
      type: 'string',
      description: 'Name of the attachment field',
    },
    remainingAttachments: {
      type: 'number',
      description: 'Number of attachments remaining in the field after removal',
    },
  },
}
