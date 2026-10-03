import type { AffinityEntityResponse, AffinityGetMergeParams } from '@/tools/affinity/types'
import { MERGE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_MERGE_ENTITY_TYPES,
  AFFINITY_MERGE_PREFIXES,
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireOneOf,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetMergeTool: ToolConfig<
  AffinityGetMergeParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_merge',
  name: 'Affinity Get Merge',
  description: 'Read the status of one company or person merge, including why it failed if it did.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Which merge to read: companies or persons',
    },
    mergeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The merge ID',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_MERGE_ENTITY_TYPES, 'entityType')
      const mergeId = encodeURIComponent(requireId(params.mergeId, 'mergeId'))
      return buildAffinityUrl(`/${AFFINITY_MERGE_PREFIXES[entityType]}-merges/${mergeId}`)
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: MERGE_OUTPUT_PROPERTIES,
}
