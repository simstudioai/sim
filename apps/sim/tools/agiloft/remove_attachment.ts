import type {
  AgiloftRemoveAttachmentParams,
  AgiloftRemoveAttachmentResponse,
} from '@/tools/agiloft/types'
import { buildRemoveAttachmentUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
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
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftRemoveAttachmentResponse>(
      params,
      (base) => ({
        url: buildRemoveAttachmentUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        const text = await response.text()

        if (!response.ok) {
          return {
            success: false,
            output: {
              recordId: params.recordId?.trim() ?? '',
              fieldName: params.fieldName?.trim() ?? '',
              remainingAttachments: 0,
            },
            error: `Agiloft error: ${response.status} - ${text}`,
          }
        }

        let remainingAttachments = 0
        try {
          const data = JSON.parse(text)
          const result = data.result ?? data
          remainingAttachments =
            typeof result === 'number' ? result : (result.count ?? result.remaining ?? 0)
        } catch {
          remainingAttachments = Number(text) || 0
        }

        return {
          success: true,
          output: {
            recordId: params.recordId?.trim() ?? '',
            fieldName: params.fieldName?.trim() ?? '',
            remainingAttachments,
          },
        }
      }
    )
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
