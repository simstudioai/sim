import type { AffinityEntityResponse, AffinityGetListParams } from '@/tools/affinity/types'
import { LIST_WITH_TYPE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetListTool: ToolConfig<
  AffinityGetListParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_list',
  name: 'Affinity Get List',
  description: 'Read one list — its name, type, owner, and privacy setting.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(`/lists/${encodeURIComponent(requireId(params.listId, 'listId'))}`),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: LIST_WITH_TYPE_OUTPUT_PROPERTIES,
}
