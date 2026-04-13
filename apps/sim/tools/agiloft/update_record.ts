import type { AgiloftRecordResponse, AgiloftUpdateRecordParams } from '@/tools/agiloft/types'
import { buildUpdateRecordUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftUpdateRecordTool: ToolConfig<AgiloftUpdateRecordParams, AgiloftRecordResponse> =
  {
    id: 'agiloft_update_record',
    name: 'Agiloft Update Record',
    description: 'Update an existing record in an Agiloft table.',
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
        description: 'ID of the record to update',
      },
      data: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Updated field values as a JSON object (e.g., {"status": "Active", "priority": "High"})',
      },
    },

    request: {
      url: 'https://placeholder.agiloft.com',
      method: 'PUT',
      headers: () => ({}),
    },

    directExecution: async (params) => {
      let body: string
      try {
        body = JSON.stringify(JSON.parse(params.data))
      } catch {
        return {
          success: false,
          output: { id: null, fields: {} },
          error: 'Invalid JSON in data parameter',
        }
      }

      return executeAgiloftRequest<AgiloftRecordResponse>(
        params,
        (base) => ({
          url: buildUpdateRecordUrl(base, params),
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
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
        description: 'ID of the updated record',
      },
      fields: {
        type: 'json',
        description: 'Updated field values of the record',
      },
    },
  }
