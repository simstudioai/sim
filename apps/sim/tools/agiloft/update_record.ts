import type { AgiloftRecordResponse, AgiloftUpdateRecordParams } from '@/tools/agiloft/types'
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
      url: () => '/api/tools/agiloft/update_record',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        instanceUrl: params.instanceUrl,
        knowledgeBase: params.knowledgeBase,
        login: params.login,
        password: params.password,
        table: params.table,
        recordId: params.recordId,
        data: params.data,
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
