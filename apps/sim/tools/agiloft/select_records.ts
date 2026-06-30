import type { AgiloftSelectRecordsParams, AgiloftSelectResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftSelectRecordsTool: ToolConfig<
  AgiloftSelectRecordsParams,
  AgiloftSelectResponse
> = {
  id: 'agiloft_select_records',
  name: 'Agiloft Select Records',
  description: 'Select record IDs matching a SQL WHERE clause from an Agiloft table.',
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
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SQL WHERE clause using database column names (e.g., "summary like \'%new%\'" or "assigned_person=\'John Doe\'")',
    },
  },

  request: {
    url: () => '/api/tools/agiloft/select_records',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      where: params.where,
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
    recordIds: {
      type: 'array',
      description: 'Array of record IDs matching the query',
      items: {
        type: 'string',
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching records',
    },
  },
}
