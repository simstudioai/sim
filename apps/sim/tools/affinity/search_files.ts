import type {
  AffinityKeywordSearchResponse,
  AffinitySearchByKeywordParams,
} from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  buildKeywordSearchBody,
  transformKeywordSearch,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinitySearchFilesTool: ToolConfig<
  AffinitySearchByKeywordParams,
  AffinityKeywordSearchResponse<'results'>
> = {
  id: 'affinity_search_files',
  name: 'Affinity Search Files',
  description:
    'Search files by keyword, ordered by relevance. Narrow to specific files or to one company, or leave both unset to search the whole account.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What to search for. Between 3 and 500 characters',
    },
    ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the search to these file IDs. Cannot be combined with Company ID',
    },
    companyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Restrict the search to one company's files. Cannot be combined with file IDs",
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of files to return, 1-100. Defaults to 20',
    },
  },

  request: {
    url: () => buildAffinityUrl('/files/search'),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => buildKeywordSearchBody(params, 'fileIds'),
  },

  transformResponse: transformKeywordSearch('results'),

  outputs: {
    results: {
      type: 'array',
      description: 'Matching files, most relevant first',
      items: {
        type: 'object',
        properties: {
          file: { type: 'json', description: 'The matched file as {id, name}' },
          pageNumber: {
            type: 'number',
            nullable: true,
            description: 'Page the match was found on, for paginated documents',
          },
          preview: { type: 'string', description: 'Snippet of the file around the match' },
        },
      },
    },
    count: { type: 'number', description: 'Number of matches returned' },
  },
}
