import type { AgiloftCreateRecordParams, AgiloftRecordResponse } from '@/tools/agiloft/types'
import { buildCreateRecordUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftCreateRecordTool: ToolConfig<AgiloftCreateRecordParams, AgiloftRecordResponse> =
  {
    id: 'agiloft_create_record',
    name: 'Agiloft Create Record',
    description: 'Create a new record in an Agiloft table.',
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
      data: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Record field values as a JSON object (e.g., {"first_name": "John", "status": "Active"})',
      },
    },

    request: {
      url: 'https://placeholder.agiloft.com',
      method: 'POST',
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
          url: buildCreateRecordUrl(base, params),
          method: 'POST',
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

          const data = (await response.json()) as Record<string, unknown>
          const result = (data.result ?? data) as Record<string, unknown>
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
        description: 'ID of the created record',
      },
      fields: {
        type: 'json',
        description: 'Field values of the created record',
      },
    },
  }
