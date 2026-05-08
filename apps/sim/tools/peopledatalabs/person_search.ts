import type { PdlPersonSearchParams, PdlPersonSearchResponse } from '@/tools/peopledatalabs/types'
import { PDL_PERSON_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { projectPerson } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const personSearchTool: ToolConfig<PdlPersonSearchParams, PdlPersonSearchResponse> = {
  id: 'pdl_person_search',
  name: 'PDL Person Search',
  description:
    'Search the People Data Labs person dataset using SQL or Elasticsearch DSL. Returns up to 100 matching records per call.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    sql: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "PDL SQL query (e.g., \"SELECT * FROM person WHERE job_title='engineer' AND location_country='united states'\")",
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch DSL query as JSON string. Use either sql or query, not both.',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-100, default 1)',
    },
    scroll_token: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token returned from a prior response',
    },
    dataset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Dataset filter: all, resume, email, phone, mobile_phone, street_address, consumer_social, developer (combinable with commas, exclude with `-` prefix)',
    },
    titlecase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return name fields in title case',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/person/search',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.sql) body.sql = params.sql
      if (params.query) {
        try {
          body.query = JSON.parse(params.query)
        } catch {
          body.query = params.query
        }
      }
      if (params.size !== undefined) body.size = Number(params.size)
      if (params.scroll_token) body.scroll_token = params.scroll_token
      if (params.dataset) body.dataset = params.dataset
      if (params.titlecase !== undefined) body.titlecase = params.titlecase
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>
    const status = (data.status as number) ?? response.status

    if (status === 404) {
      return { success: true, output: { total: 0, scroll_token: null, results: [] } }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const records = (data.data as Record<string, unknown>[]) ?? []
    return {
      success: true,
      output: {
        total: (data.total as number) ?? records.length,
        scroll_token: (data.scroll_token as string) ?? null,
        results: records.map(projectPerson),
      },
    }
  },

  outputs: {
    total: { type: 'number', description: 'Total matching records in dataset' },
    scroll_token: {
      type: 'string',
      description: 'Pagination token to fetch the next page; null if no more results',
      optional: true,
    },
    results: {
      type: 'array',
      description: 'Person records matching the query',
      items: { type: 'object', properties: PDL_PERSON_OUTPUT_PROPERTIES },
    },
  },
}
