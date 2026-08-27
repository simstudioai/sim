import type { AgiloftSearchRecordsParams, AgiloftSearchResponse } from '@/tools/agiloft/types'
import type { InternalToolConfig } from '@/tools/types'

export const agiloftSearchRecordsTool: InternalToolConfig<
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
      required: false,
      visibility: 'user-or-llm',
      description:
        "Ad hoc EWSearch query. Combine conditions with && (and) or || (or) and quote every value — e.g. \"summary~='test'&&priority='High'\". Required unless a saved search is given.",
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Label of a saved search defined on the table (e.g., "C: Status is Closed"). Can be combined with a query to narrow it further.',
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
      description:
        'Maximum number of records to return per page. Agiloft treats 0 as "all records", so leave it unset or use a positive value to keep result sizes bounded.',
    },
  },

  operation: {
    input: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      query: params.query,
      search: params.search,
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
    truncated: {
      type: 'boolean',
      description: 'True when more records were returned upstream than this call reports',
    },
    records: {
      type: 'json',
      description: 'Array of matching records with their field values',
    },
    totalCount: {
      type: 'number',
      description:
        'Number of records in this response. Not a total match count — compare with `truncated`.',
    },
    page: {
      type: 'number',
      description: 'Page number that was requested (0-based)',
    },
    limit: {
      type: 'number',
      description: 'Page size that was requested; 0 when no limit was sent and Agiloft chose one',
    },
  },
}
