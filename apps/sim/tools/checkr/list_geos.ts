import {
  type CheckrListGeosParams,
  type CheckrListGeosResponse,
  GEO_PROPERTIES,
  LIST_META_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapGeo,
  mapListMeta,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListGeosTool: ToolConfig<CheckrListGeosParams, CheckrListGeosResponse> = {
  id: 'checkr_list_geos',
  name: 'Checkr List Geos',
  description:
    'List geos (work locations used for compliance), optionally filtered by name or state.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return geos with this name',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return geos in this two-letter state',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl('/geos', {
        name: params.name,
        state: params.state,
        ...checkrPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        geos: (Array.isArray(data.data) ? data.data : []).map(mapGeo),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    geos: {
      type: 'array',
      description: 'Matching geos',
      items: { type: 'object', properties: GEO_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
