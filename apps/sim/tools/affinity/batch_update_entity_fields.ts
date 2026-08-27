import type {
  AffinityBatchOperationResponse,
  AffinityBatchUpdateEntityFieldsParams,
} from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityError,
  affinityHeaders,
  buildAffinityUrl,
  parseFieldUpdates,
  readAffinityJson,
  requireId,
  requireOneOf,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityBatchUpdateEntityFieldsTool: ToolConfig<
  AffinityBatchUpdateEntityFieldsParams,
  AffinityBatchOperationResponse
> = {
  id: 'affinity_batch_update_entity_fields',
  name: 'Affinity Batch Update Entity Fields',
  description:
    'Write up to 100 non-list field values on one company or person in a single request.',
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
      description: 'Which entity to write the fields on: companies or persons',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of that company or person',
    },
    updates: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Up to 100 field updates as [{"id":"<fieldId>","value":{"type":"…","data":…}}], using the same value shapes as a single field update',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')
      const entityId = encodeURIComponent(requireId(params.entityId, 'entityId'))
      return buildAffinityUrl(`/${entityType}/${entityId}/fields`)
    },
    method: 'PATCH',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      return { operation: 'update-fields', updates: parseFieldUpdates(params.updates) }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) throw await affinityError(response)
    const data = await readAffinityJson<{ operation?: string }>(response)
    return { success: true, output: { operation: data.operation ?? 'update-fields' } }
  },

  outputs: {
    operation: { type: 'string', description: 'The batch operation Affinity performed' },
  },
}
