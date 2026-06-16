import type { AgiloftCreateRecordParams, AgiloftRecordResponse } from '@/tools/agiloft/types'
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
      url: () => '/api/tools/agiloft/create_record',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        instanceUrl: params.instanceUrl,
        knowledgeBase: params.knowledgeBase,
        login: params.login,
        password: params.password,
        table: params.table,
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
        description: 'ID of the created record',
      },
      fields: {
        type: 'json',
        description: 'Field values of the created record',
      },
    },
  }
