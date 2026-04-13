import type { AgiloftReadRecordParams, AgiloftRecordResponse } from '@/tools/agiloft/types'
import { buildReadRecordUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftReadRecordTool: ToolConfig<AgiloftReadRecordParams, AgiloftRecordResponse> = {
  id: 'agiloft_read_record',
  name: 'Agiloft Read Record',
  description: 'Read a record by ID from an Agiloft table.',
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
      description: 'ID of the record to read',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of field names to include in the response',
    },
  },

  request: {
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftRecordResponse>(
      params,
      (base) => ({
        url: buildReadRecordUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = await response.json()
        const result = data.result ?? data
        const id = result.id ?? result.ID ?? data.id ?? data.ID ?? null

        return {
          success: data.success !== false,
          output: {
            id: id != null ? String(id) : null,
            fields: result ?? {},
          },
        }
      }
    )
  },

  outputs: {
    id: {
      type: 'string',
      description: 'ID of the record',
    },
    fields: {
      type: 'json',
      description: 'Field values of the record',
    },
  },
}
