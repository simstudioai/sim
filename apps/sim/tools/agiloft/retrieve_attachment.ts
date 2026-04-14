import type {
  AgiloftRetrieveAttachmentParams,
  AgiloftRetrieveAttachmentResponse,
} from '@/tools/agiloft/types'
import { buildRetrieveAttachmentUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
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
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftRetrieveAttachmentResponse>(
      params,
      (base) => ({
        url: buildRetrieveAttachmentUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: {
              file: { name: '', mimeType: '', data: '', size: 0 },
            },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
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
          },
        }
      }
    )
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded attachment file',
    },
  },
}
