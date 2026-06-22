import type { AgiloftReadRecordParams, AgiloftRecordResponse } from '@/tools/agiloft/types'
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
    url: () => '/api/tools/agiloft/read_record',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      recordId: params.recordId,
      fields: params.fields,
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
      description: 'ID of the record',
    },
    fields: {
      type: 'json',
      description: 'Field values of the record',
    },
  },
}
