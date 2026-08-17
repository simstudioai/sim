import { authParams } from '@/tools/servicenow/params'
import type {
  ServiceNowSearchKnowledgeParams,
  ServiceNowSearchKnowledgeResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  readNestedNumber,
  readRecordArray,
  toRecordObject,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const searchKnowledgeTool: ToolConfig<
  ServiceNowSearchKnowledgeParams,
  ServiceNowSearchKnowledgeResponse
> = {
  id: 'servicenow_search_knowledge',
  name: 'Search ServiceNow Knowledge',
  description:
    'Search ServiceNow knowledge base articles through the Knowledge Management API. Returns ranked results with a snippet and the article number, which Get ServiceNow Knowledge Article accepts to fetch the full body.',
  version: '1.0.0',

  params: {
    ...authParams,
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text to search for across knowledge articles.',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Encoded query used to filter the results, against the Knowledge [kb_knowledge] table (e.g., "workflow_state=published").',
    },
    knowledgeBaseSysIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated knowledge base sys_ids (from kb_knowledge_base) to restrict results to.',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated ISO 639-1 language codes to restrict results to, or "all". Defaults to the session language.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated kb_knowledge fields to include in each result (e.g., workflow_state,kb_category).',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of articles to return. ServiceNow defaults to 30.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of articles to skip for pagination.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()

      if (params.query) searchParams.append('query', params.query)
      if (params.filter) searchParams.append('filter', params.filter)
      if (params.knowledgeBaseSysIds) searchParams.append('kb', params.knowledgeBaseSysIds)
      if (params.language) searchParams.append('language', params.language)
      if (params.fields) searchParams.append('fields', params.fields)
      if (params.limit !== undefined && params.limit !== null) {
        searchParams.append('limit', String(params.limit))
      }
      if (params.offset !== undefined && params.offset !== null) {
        searchParams.append('offset', String(params.offset))
      }

      return withQueryString(`${baseUrl}/api/sn_km_api/knowledge/articles`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const result = toRecordObject(data.result)
    const articles = readRecordArray(result, 'articles')

    return {
      success: true,
      output: {
        articles,
        metadata: {
          recordCount: articles.length,
          totalCount: readNestedNumber(result, 'meta', 'count'),
        },
      },
    }
  },

  outputs: {
    articles: {
      type: 'array',
      description: 'Matching knowledge articles, sorted in descending order by relevance score',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Table-prefixed article identifier, e.g. "kb_knowledge:9e528db1...". Get ServiceNow Knowledge Article takes a bare sys_id or KB number, so pass `number` or the portion after the colon rather than this value as-is',
          },
          number: { type: 'string', description: 'Knowledge article number' },
          title: { type: 'string', description: 'Article title (short description)' },
          snippet: { type: 'string', description: 'Small excerpt of the article text' },
          link: { type: 'string', description: 'Link to the article' },
          score: { type: 'number', description: 'Relevancy score' },
          rank: { type: 'number', description: 'Search rank of the article for this search' },
          fields: {
            type: 'json',
            description:
              'Requested kb_knowledge fields, each {name, label, type, value, display_value}',
            optional: true,
          },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Number of articles returned' },
        totalCount: {
          type: 'number',
          description: 'Total number of available articles reported by ServiceNow',
          nullable: true,
        },
      },
    },
  },
}
