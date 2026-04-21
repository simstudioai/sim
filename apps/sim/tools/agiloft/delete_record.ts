import type { AgiloftDeleteRecordParams, AgiloftDeleteResponse } from '@/tools/agiloft/types'
import { buildDeleteRecordUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftDeleteRecordTool: ToolConfig<AgiloftDeleteRecordParams, AgiloftDeleteResponse> =
  {
    id: 'agiloft_delete_record',
    name: 'Agiloft Delete Record',
    description: 'Delete a record from an Agiloft table.',
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
        description: 'Table name (e.g., "contracts", "contacts.employees")',
      },
      recordId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the record to delete',
      },
    },

    request: {
      url: 'https://placeholder.agiloft.com',
      method: 'DELETE',
      headers: () => ({}),
    },

    directExecution: async (params) => {
      return executeAgiloftRequest<AgiloftDeleteResponse>(
        params,
        (base) => ({
          url: buildDeleteRecordUrl(base, params),
          method: 'DELETE',
        }),
        async (response) => {
          if (!response.ok) {
            const errorText = await response.text()
            return {
              success: false,
              output: { id: params.recordId?.trim() ?? '', deleted: false },
              error: `Agiloft error: ${response.status} - ${errorText}`,
            }
          }

          return {
            success: true,
            output: {
              id: params.recordId?.trim() ?? '',
              deleted: true,
            },
          }
        }
      )
    },

    outputs: {
      id: {
        type: 'string',
        description: 'ID of the deleted record',
      },
      deleted: {
        type: 'boolean',
        description: 'Whether the record was successfully deleted',
      },
    },
  }
