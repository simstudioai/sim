import type {
  AgiloftRetrieveAttachmentParams,
  AgiloftRetrieveAttachmentResponse,
} from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftRetrieveAttachmentTool: ToolConfig<
  AgiloftRetrieveAttachmentParams,
  AgiloftRetrieveAttachmentResponse
> = {
  id: 'agiloft_retrieve_attachment',
  name: 'Agiloft Retrieve Attachment',
  description: 'Download an attached file from an Agiloft record field.',
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
      description: 'Position index of the file in the field (starting from 0)',
    },
  },

  request: {
    url: '/api/tools/agiloft/retrieve',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
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

    if (!data.success) {
      return {
        success: false,
        output: {
          file: { name: '', mimeType: '', data: '', size: 0 },
        },
        error: data.error || 'Failed to retrieve attachment',
      }
    }

    return {
      success: true,
      output: {
        file: {
          name: data.output.file.name,
          mimeType: data.output.file.mimeType,
          data: data.output.file.data,
          size: data.output.file.size,
        },
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded attachment file',
    },
  },
}
