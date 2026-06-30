import type { AgiloftDeleteRecordParams, AgiloftDeleteResponse } from '@/tools/agiloft/types'
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
      url: () => '/api/tools/agiloft/delete_record',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        instanceUrl: params.instanceUrl,
        knowledgeBase: params.knowledgeBase,
        login: params.login,
        password: params.password,
        table: params.table,
        recordId: params.recordId,
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
        description: 'ID of the deleted record',
      },
      deleted: {
        type: 'boolean',
        description: 'Whether the record was successfully deleted',
      },
    },
  }
