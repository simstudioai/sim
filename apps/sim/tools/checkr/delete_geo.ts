import type { CheckrDeleteGeoResponse, CheckrGeoIdParams } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrDeleteGeoTool: ToolConfig<CheckrGeoIdParams, CheckrDeleteGeoResponse> = {
  id: 'checkr_delete_geo',
  name: 'Checkr Delete Geo',
  description: 'Delete a geo.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    geoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the geo to delete',
    },
  },

  request: {
    url: (params) => checkrUrl(`/geos/${checkrId(params.geoId, 'geoId')}`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (_response: Response, params) => ({
    success: true,
    output: { deleted: true, geoId: params?.geoId?.trim() ?? '' },
  }),

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the geo was deleted' },
    geoId: { type: 'string', description: 'ID of the deleted geo' },
  },
}
