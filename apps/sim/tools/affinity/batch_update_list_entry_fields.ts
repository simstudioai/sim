import type {
  AffinityBatchOperationResponse,
  AffinityBatchUpdateListEntryFieldsParams,
} from '@/tools/affinity/types'
import {
  affinityError,
  affinityHeaders,
  buildAffinityUrl,
  parseFieldUpdates,
  readAffinityJson,
  requireId,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityBatchUpdateListEntryFieldsTool: ToolConfig<
  AffinityBatchUpdateListEntryFieldsParams,
  AffinityBatchOperationResponse
> = {
  id: 'affinity_batch_update_list_entry_fields',
  name: 'Affinity Batch Update List Entry Fields',
  description:
    'Write up to 100 field values on one list row in a single request. Requires the "Export data from Lists" permission.',
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
    listEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list entry ID',
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
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const listEntryId = encodeURIComponent(requireId(params.listEntryId, 'listEntryId'))
      return buildAffinityUrl(`/lists/${listId}/list-entries/${listEntryId}/fields`)
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
