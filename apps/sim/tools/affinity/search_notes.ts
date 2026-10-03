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

export const affinitySearchNotesTool: ToolConfig<
  AffinitySearchByKeywordParams,
  AffinityKeywordSearchResponse<'results'>
> = {
  id: 'affinity_search_notes',
  name: 'Affinity Search Notes',
  description:
    'Search notes by keyword, ordered by relevance. Narrow to specific notes or to one company, or leave both unset to search the whole account.',
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
      description: 'Restrict the search to these note IDs. Cannot be combined with Company ID',
    },
    companyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Restrict the search to one company's notes. Cannot be combined with note IDs",
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of notes to return, 1-100. Defaults to 20',
    },
  },

  request: {
    url: () => buildAffinityUrl('/notes/search'),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => buildKeywordSearchBody(params, 'noteIds'),
  },

  transformResponse: transformKeywordSearch('results'),

  outputs: {
    results: {
      type: 'array',
      description: 'Matching notes, most relevant first',
      items: {
        type: 'object',
        properties: {
          note: { type: 'json', description: 'The matched note as {id, kind}' },
          preview: { type: 'string', description: 'Snippet of the note around the match' },
        },
      },
    },
    count: { type: 'number', description: 'Number of matches returned' },
  },
}
