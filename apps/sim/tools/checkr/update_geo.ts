import {
  type CheckrGeoResponse,
  type CheckrUpdateGeoParams,
  GEO_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapGeo,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrUpdateGeoTool: ToolConfig<CheckrUpdateGeoParams, CheckrGeoResponse> = {
  id: 'checkr_update_geo',
  name: 'Checkr Update Geo',
  description: 'Add a city to a geo. A geo’s city can only be set once.',
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
    city: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'City to set on the geo',
    },
  },

  request: {
    url: (params) => checkrUrl(`/geos/${checkrId(params.geoId, 'geoId')}`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => ({ city: trimmed(params.city) }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { geo: mapGeo(data) } }
  },

  outputs: {
    geo: { type: 'object', description: 'The updated geo', properties: GEO_PROPERTIES },
  },
}
