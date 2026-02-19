import type {
  AlgoliaBrowseRecordsParams,
  AlgoliaBrowseRecordsResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const browseRecordsTool: ToolConfig<
  AlgoliaBrowseRecordsParams,
  AlgoliaBrowseRecordsResponse
> = {
  id: 'algolia_browse_records',
  name: 'Algolia Browse Records',
  description: 'Browse and iterate over all records in an Algolia index using cursor pagination',
  version: '1.0',

  params: {
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Application ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia API Key (must have browse ACL)',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index to browse',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter browsed records',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter string to narrow down results',
    },
    attributesToRetrieve: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of attributes to retrieve',
    },
    hitsPerPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of hits per page (default: 1000, max: 1000)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous browse response for pagination',
    },
  },

  request: {
    url: (params) =>
      `https://${params.applicationId}-dsn.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/browse`,
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.cursor) {
        return { cursor: params.cursor }
      }
      const body: Record<string, unknown> = {}
      if (params.query) body.query = params.query
      if (params.filters) body.filters = params.filters
      if (params.attributesToRetrieve) {
        body.attributesToRetrieve = params.attributesToRetrieve
          .split(',')
          .map((a: string) => a.trim())
      }
      if (params.hitsPerPage !== undefined) body.hitsPerPage = Number(params.hitsPerPage)
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        hits: data.hits ?? [],
        cursor: data.cursor ?? null,
        nbHits: data.nbHits ?? 0,
        page: data.page ?? 0,
        nbPages: data.nbPages ?? 0,
        hitsPerPage: data.hitsPerPage ?? 1000,
        processingTimeMS: data.processingTimeMS ?? 0,
      },
    }
  },

  outputs: {
    hits: {
      type: 'array',
      description: 'Array of records from the index (up to 1000 per request)',
      items: {
        type: 'object',
        description: 'A record object containing objectID plus any requested attributes',
        properties: {
          objectID: {
            type: 'string',
            description: 'Unique identifier of the record',
          },
        },
      },
    },
    cursor: {
      type: 'string',
      description:
        'Opaque cursor string for retrieving the next page of results. Absent when no more results exist.',
      optional: true,
    },
    nbHits: {
      type: 'number',
      description: 'Total number of records matching the browse criteria',
    },
    page: {
      type: 'number',
      description: 'Current page number (zero-based)',
    },
    nbPages: {
      type: 'number',
      description: 'Total number of pages available',
    },
    hitsPerPage: {
      type: 'number',
      description: 'Number of hits per page (1-1000, default 1000 for browse)',
    },
    processingTimeMS: {
      type: 'number',
      description: 'Server-side processing time in milliseconds',
    },
  },
}
