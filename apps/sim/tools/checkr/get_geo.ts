import {
  type CheckrGeoIdParams,
  type CheckrGeoResponse,
  GEO_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapGeo,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetGeoTool: ToolConfig<CheckrGeoIdParams, CheckrGeoResponse> = {
  id: 'checkr_get_geo',
  name: 'Checkr Get Geo',
  description: 'Retrieve a geo by ID.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    geoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the geo',
    },
  },

  request: {
    url: (params) => checkrUrl(`/geos/${checkrId(params.geoId, 'geoId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { geo: mapGeo(data) } }
  },

  outputs: {
    geo: { type: 'object', description: 'The geo', properties: GEO_PROPERTIES },
  },
}
