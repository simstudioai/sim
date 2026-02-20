import { createLogger } from '@sim/logger'
import type {
  DataverseSearchParams,
  DataverseSearchResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseSearch')

export const dataverseSearchTool: ToolConfig<DataverseSearchParams, DataverseSearchResponse> = {
  id: 'microsoft_dataverse_search',
  name: 'Search Microsoft Dataverse',
  description:
    'Perform a full-text relevance search across Microsoft Dataverse tables. Requires Dataverse Search to be enabled on the environment. Supports simple and Lucene query syntax.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },
  errorExtractor: 'nested-error-object',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Microsoft Dataverse API',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dataverse environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    searchTerm: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search text (1-100 chars). Supports simple syntax: + (AND), | (OR), - (NOT), * (wildcard), "exact phrase"',
    },
    entities: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of search entity configs. Each object: {"Name":"account","SelectColumns":["name"],"SearchColumns":["name"],"Filter":"statecode eq 0"}',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Global OData filter applied across all entities (e.g., "createdon gt 2024-01-01")',
    },
    facets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of facet specifications (e.g., ["entityname,count:100","ownerid,count:100"])',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default: 50, max: 100)',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of sort expressions (e.g., ["createdon desc"])',
    },
    searchMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search mode: "any" (default, match any term) or "all" (match all terms)',
    },
    searchType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Query type: "simple" (default) or "lucene" (enables regex, fuzzy, proximity, boosting)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/searchquery`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        search: params.searchTerm,
        count: true,
      }
      if (params.entities) body.entities = params.entities
      if (params.filter) body.filter = params.filter
      if (params.facets) body.facets = params.facets
      if (params.top) body.top = params.top
      if (params.skip) body.skip = params.skip
      if (params.orderBy) body.orderby = params.orderBy

      const options: Record<string, string> = {}
      if (params.searchMode) options.searchmode = params.searchMode
      if (params.searchType) options.querytype = params.searchType
      if (Object.keys(options).length > 0) {
        body.options = JSON.stringify(options).replace(/"/g, "'")
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse search failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json()
    let parsedResponse = data.response
    if (typeof parsedResponse === 'string') {
      try {
        parsedResponse = JSON.parse(parsedResponse)
      } catch {
        parsedResponse = {}
      }
    }

    const results = parsedResponse?.Value ?? []
    const totalCount = parsedResponse?.Count ?? 0
    const facets = parsedResponse?.Facets ?? null

    return {
      success: true,
      output: {
        results,
        totalCount,
        count: results.length,
        facets,
        success: true,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of search result objects',
      items: {
        type: 'object',
        properties: {
          Id: { type: 'string', description: 'Record GUID' },
          EntityName: {
            type: 'string',
            description: 'Table logical name (e.g., account, contact)',
          },
          ObjectTypeCode: { type: 'number', description: 'Entity type code' },
          Attributes: {
            type: 'object',
            description: 'Record attributes matching the search. Keys are column logical names.',
          },
          Highlights: {
            type: 'object',
            description:
              'Highlighted search matches. Keys are column names, values are arrays of strings with {crmhit}/{/crmhit} markers.',
            optional: true,
          },
          Score: { type: 'number', description: 'Relevance score for this result' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching records across all tables',
    },
    count: { type: 'number', description: 'Number of results returned in this page' },
    facets: {
      type: 'object',
      description:
        'Facet results when facets were requested. Keys are facet names, values are arrays of facet value objects with count and value properties.',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
