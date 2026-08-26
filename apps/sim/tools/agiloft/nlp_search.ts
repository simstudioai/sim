import type { AgiloftNlpSearchParams, AgiloftNlpSearchResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftNlpSearchTool: ToolConfig<AgiloftNlpSearchParams, AgiloftNlpSearchResponse> = {
  id: 'agiloft_nlp_search',
  name: 'Agiloft Natural Language Search',
  description:
    'Search Agiloft records by describing what you want in plain language, such as "active NDAs submitted last month".',
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
    nlpQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The request in plain language, e.g. "Show me open, high-priority contracts". Structured field filters are not accepted — use Search Records for those.',
    },
    fields: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated field names to return, e.g. "id, contract_title1, company_name"',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number, starting from 0',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Records per page',
    },
  },

  request: {
    internal: true,
    url: () => '/api/tools/agiloft/nlp_search',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      nlpQuery: params.nlpQuery,
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
    records: { type: 'json', description: 'Matching records with the requested field values' },
    totalCount: { type: 'number', description: 'Number of records in this response' },
    truncated: {
      type: 'boolean',
      description: 'True when more records were returned upstream than this call reports',
    },
  },
}
