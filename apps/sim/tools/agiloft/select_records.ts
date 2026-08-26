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
        'SQL WHERE clause using database column names (e.g., "summary like \'%new%\'" or "assigned_person=\'John Doe\'"). EWSelect has no page size and returns every matching ID, so append a database limit such as "limit 0,200" to bound the result.',
    },
  },

  request: {
    internal: true,
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
    truncated: {
      type: 'boolean',
      description: 'True when more IDs matched than this call reports',
    },
    recordIds: {
      type: 'array',
      description: 'Array of record IDs matching the query',
      items: {
        type: 'string',
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of IDs in this response — compare with `truncated`',
    },
  },
}
