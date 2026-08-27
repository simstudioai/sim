import type { AffinityEntityResponse, AffinityGetSavedViewParams } from '@/tools/affinity/types'
import { SAVED_VIEW_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetSavedViewTool: ToolConfig<
  AffinityGetSavedViewParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_saved_view',
  name: 'Affinity Get Saved View',
  description: 'Read one saved view — its name, kind, and creation date.',
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
    viewId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The saved view ID',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const viewId = encodeURIComponent(requireId(params.viewId, 'viewId'))
      return buildAffinityUrl(`/lists/${listId}/saved-views/${viewId}`)
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: SAVED_VIEW_OUTPUT_PROPERTIES,
}
