import type { AlgoliaListIndicesParams, AlgoliaListIndicesResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Coerces a pagination parameter to the non-negative integer Algolia declares.
 *
 * The parameter is `visibility: 'user-or-llm'` and the Algolia block still
 * forwards it as a short-input string, so `'0&hitsPerPage=1000'` is a value the
 * builder genuinely receives. `URLSearchParams` alone would percent-encode the
 * `&` and stop the smuggling, but it would also send that whole string as the
 * value of `page`; rejecting a value that is not a number reports the bad input
 * instead of asking Algolia to reject it. A numeric string (`'0'`, `'100'`) is
 * the normal UI path and passes through unchanged.
 */
function paginationValue(value: string | number, paramName: string): string {
  const raw = typeof value === 'number' ? value : String(value).trim()
  const parsed = raw === '' ? Number.NaN : Number(raw)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${paramName} must be a non-negative integer`)
  }

  return String(parsed)
}

export const listIndicesTool: ToolConfig<AlgoliaListIndicesParams, AlgoliaListIndicesResponse> = {
  id: 'algolia_list_indices',
  name: 'Algolia List Indices',
  description: 'List all indices in an Algolia application',
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
      description: 'Algolia API Key',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for paginating indices (default: not paginated)',
    },
    hitsPerPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of indices per page (default: 100)',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const base = `https://${params.applicationId}-dsn.algolia.net/1/indexes`
      const queryParams = new URLSearchParams()
      if (params.page !== undefined) {
        queryParams.set('page', paginationValue(params.page, 'page'))
      }
      if (params.hitsPerPage !== undefined) {
        queryParams.set('hitsPerPage', paginationValue(params.hitsPerPage, 'hitsPerPage'))
      }
      const query = queryParams.toString()
      return query ? `${base}?${query}` : base
    },
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const indices = (data.items ?? []).map(
      (item: {
        name: string
        entries: number
        dataSize: number
        fileSize: number
        lastBuildTimeS: number
        numberOfPendingTasks: number
        pendingTask: boolean
        createdAt: string
        updatedAt: string
        primary?: string
        replicas?: string[]
        virtual?: boolean
      }) => ({
        name: item.name ?? '',
        entries: item.entries ?? 0,
        dataSize: item.dataSize ?? 0,
        fileSize: item.fileSize ?? 0,
        lastBuildTimeS: item.lastBuildTimeS ?? 0,
        numberOfPendingTasks: item.numberOfPendingTasks ?? 0,
        pendingTask: item.pendingTask ?? false,
        createdAt: item.createdAt ?? '',
        updatedAt: item.updatedAt ?? '',
        primary: item.primary ?? null,
        replicas: item.replicas ?? [],
        virtual: item.virtual ?? false,
      })
    )
    return {
      success: true,
      output: {
        indices,
        nbPages: data.nbPages ?? 1,
      },
    }
  },

  outputs: {
    indices: {
      type: 'array',
      description: 'List of indices in the application',
      items: {
        type: 'object',
        description: 'An Algolia index',
        properties: {
          name: { type: 'string', description: 'Name of the index' },
          entries: { type: 'number', description: 'Number of records in the index' },
          dataSize: { type: 'number', description: 'Size of the index data in bytes' },
          fileSize: { type: 'number', description: 'Size of the index files in bytes' },
          lastBuildTimeS: { type: 'number', description: 'Last build duration in seconds' },
          numberOfPendingTasks: {
            type: 'number',
            description: 'Number of pending indexing tasks',
          },
          pendingTask: { type: 'boolean', description: 'Whether the index has pending tasks' },
          createdAt: { type: 'string', description: 'Timestamp when the index was created' },
          updatedAt: { type: 'string', description: 'Timestamp when the index was last updated' },
          primary: {
            type: 'string',
            description: 'Name of the primary index (if this is a replica)',
            optional: true,
          },
          replicas: {
            type: 'array',
            description: 'List of replica index names',
            optional: true,
            items: { type: 'string', description: 'Replica index name' },
          },
          virtual: {
            type: 'boolean',
            description: 'Whether the index is a virtual replica',
            optional: true,
          },
        },
      },
    },
    nbPages: {
      type: 'number',
      description: 'Total number of pages of indices',
    },
  },
}
