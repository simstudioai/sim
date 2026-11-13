import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_PAGINATION_OUTPUT,
  MONACO_SEQUENCE_OUTPUT_PROPERTIES,
  type MonacoListParams,
  type MonacoListSequencesResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoPagination,
  mapMonacoSequence,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListSequencesTool: ToolConfig<MonacoListParams, MonacoListSequencesResponse> = {
  id: 'monaco_list_sequences',
  name: 'Monaco List Sequences',
  description: 'List Monaco outreach sequences with optional filters, sorting, and pagination.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_LIST_PARAMS,
  },

  request: {
    url: `${MONACO_API_BASE}/v1/sequences/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoListBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        sequences: toArray(data.data).map(mapMonacoSequence),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    sequences: {
      type: 'array',
      description: 'Sequences on this page',
      items: { type: 'object', properties: MONACO_SEQUENCE_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
