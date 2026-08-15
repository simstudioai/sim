import { createLogger } from '@sim/logger'
import type {
  DataverseSearchParams,
  DataverseSearchResponse,
} from '@/tools/microsoft_dynamics_365/types'
import {
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  isDataverseObject,
  normalizeDynamics365SearchEntities,
  parseDataverseInt32,
  parseDataverseRequiredString,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseSearch')
const DATAVERSE_INT32_MIN = -2_147_483_648
const DATAVERSE_INT32_MAX = 2_147_483_647

function isDataverseSearchHighlights(value: unknown): value is Record<string, string[]> {
  return (
    isDataverseObject(value) &&
    Object.values(value).every(
      (highlightValues) =>
        Array.isArray(highlightValues) &&
        highlightValues.every((highlight) => typeof highlight === 'string')
    )
  )
}

function isDataverseSearchFacets(
  value: unknown
): value is Record<string, Record<string, unknown>[]> {
  return (
    isDataverseObject(value) &&
    Object.values(value).every(
      (facetResults) =>
        Array.isArray(facetResults) && facetResults.every((facet) => isDataverseObject(facet))
    )
  )
}

export const microsoftDynamics365SearchRecordsTool: ToolConfig<
  DataverseSearchParams,
  DataverseSearchResponse
> = {
  id: 'microsoft_dynamics_365_search_records',
  name: 'Search Microsoft Dynamics 365 CRM Records',
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
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Trusted Dynamics 365 environment bound to the selected OAuth credential',
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
        'JSON array of search entity configs. Each object: {"name":"account","selectColumns":["name"],"searchColumns":["name"],"filter":"statecode eq 0"}',
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
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      return `${baseUrl}/api/data/v9.2/searchquery`
    },
    method: 'POST',
    stripAuthOnRedirect: true,
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      const searchTerm = parseDataverseRequiredString(params.searchTerm, 'searchTerm', 100)
      const body: Record<string, unknown> = {
        search: searchTerm,
        count: true,
      }
      body.entities = normalizeDynamics365SearchEntities(params.entities)
      if (params.filter) body.filter = params.filter
      if (params.facets) body.facets = params.facets
      if (params.top !== undefined) {
        const top = parseDataverseInt32(params.top, 'top')
        if (top < 1 || top > 100) {
          throw new Error('top must be an integer from 1 to 100')
        }
        body.top = top
      }
      if (params.skip !== undefined) {
        const skip = parseDataverseInt32(params.skip, 'skip')
        if (skip < 0) {
          throw new Error('skip must be a nonnegative integer')
        }
        body.skip = skip
      }
      if (params.orderBy) body.orderby = params.orderBy

      const options: Record<string, string> = {}
      if (params.searchMode) {
        if (params.searchMode !== 'any' && params.searchMode !== 'all') {
          throw new Error('searchMode must be any or all')
        }
        options.searchmode = params.searchMode
      }
      if (params.searchType) {
        if (params.searchType !== 'simple' && params.searchType !== 'lucene') {
          throw new Error('searchType must be simple or lucene')
        }
        options.querytype = params.searchType
      }
      if (Object.keys(options).length > 0) {
        body.options = JSON.stringify(options).replace(/"/g, "'")
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse search failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 200) {
      throw new Error(
        `Invalid Dataverse search response: expected HTTP 200, received ${response.status}`
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Invalid Dataverse search response: expected a JSON object')
    }
    if (!isDataverseObject(data) || typeof data.response !== 'string') {
      throw new Error('Invalid Dataverse search response: response must be an escaped JSON string')
    }

    let parsedResponse: unknown
    try {
      parsedResponse = JSON.parse(data.response)
    } catch {
      throw new Error('Invalid Dataverse search response: response contains invalid JSON')
    }
    if (!isDataverseObject(parsedResponse)) {
      throw new Error('Invalid Dataverse search response: response JSON must be an object')
    }

    if (parsedResponse.Error !== undefined && parsedResponse.Error !== null) {
      if (isDataverseObject(parsedResponse.Error)) {
        const message = parsedResponse.Error.message
        const code = parsedResponse.Error.code
        if (typeof message === 'string' && message.trim()) {
          const suffix = typeof code === 'string' && code.trim() ? ` (${code.trim()})` : ''
          throw new Error(`${message.trim()}${suffix}`)
        }
        if (typeof code === 'string' && code.trim()) {
          throw new Error(`Dataverse Search error: ${code.trim()}`)
        }
      }
      throw new Error('Dataverse Search returned an error')
    }

    if (!Array.isArray(parsedResponse.Value)) {
      throw new Error('Invalid Dataverse search response: Value must be an array')
    }
    for (const result of parsedResponse.Value) {
      if (
        !isDataverseObject(result) ||
        typeof result.Id !== 'string' ||
        typeof result.EntityName !== 'string' ||
        typeof result.ObjectTypeCode !== 'number' ||
        !Number.isInteger(result.ObjectTypeCode) ||
        result.ObjectTypeCode < DATAVERSE_INT32_MIN ||
        result.ObjectTypeCode > DATAVERSE_INT32_MAX ||
        !isDataverseObject(result.Attributes) ||
        typeof result.Score !== 'number' ||
        !Number.isFinite(result.Score) ||
        (result.Highlights !== undefined &&
          result.Highlights !== null &&
          !isDataverseSearchHighlights(result.Highlights))
      ) {
        throw new Error(
          'Invalid Dataverse search response: every Value item must contain the documented query-result fields'
        )
      }
    }
    if (
      typeof parsedResponse.Count !== 'number' ||
      !Number.isSafeInteger(parsedResponse.Count) ||
      parsedResponse.Count < 0
    ) {
      throw new Error('Invalid Dataverse search response: Count must be a nonnegative integer')
    }
    if (
      parsedResponse.Facets !== undefined &&
      parsedResponse.Facets !== null &&
      !isDataverseSearchFacets(parsedResponse.Facets)
    ) {
      throw new Error('Invalid Dataverse search response: Facets must be an object when returned')
    }

    const results = parsedResponse.Value
    const totalCount = parsedResponse.Count
    const facets = parsedResponse.Facets ?? null

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
      nullable: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
