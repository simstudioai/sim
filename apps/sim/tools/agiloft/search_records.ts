import type { AgiloftSearchRecordsParams, AgiloftSearchResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftSearchRecordsTool: ToolConfig<
  AgiloftSearchRecordsParams,
  AgiloftSearchResponse
> = {
  id: 'agiloft_search_records',
  name: 'Agiloft Search Records',
  description: 'Search for records in an Agiloft table using a query.',
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
      description: 'Table name to search in (e.g., "contracts", "contacts.employees")',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query using Agiloft query syntax (e.g., "status=\'Active\'" or "company_name~=\'Acme\'")',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of field names to include in the results',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for paginated results (starting from 0)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return per page',
    },
  },

  request: {
    url: () => '/api/tools/agiloft/search_records',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      query: params.query,
      fields: params.fields,
      page: params.page,
      limit: params.limit,
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
    records: {
      type: 'json',
      description: 'Array of matching records with their field values',
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching records',
    },
    page: {
      type: 'number',
      description: 'Current page number',
    },
    limit: {
      type: 'number',
      description: 'Records per page',
    },
  },
}
