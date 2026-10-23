import {
  type CheckrCreateGeoParams,
  type CheckrGeoResponse,
  GEO_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrUrl,
  mapGeo,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateGeoTool: ToolConfig<CheckrCreateGeoParams, CheckrGeoResponse> = {
  id: 'checkr_create_geo',
  name: 'Checkr Create Geo',
  description:
    'Create a geo to group candidates by work location. A geo with the same name and state already existing returns an error.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the geo, e.g. San Francisco',
    },
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Two-letter US state for the geo, e.g. CA',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A major city within the state',
    },
  },

  request: {
    url: () => checkrUrl('/geos'),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: trimmed(params.name),
        state: trimmed(params.state),
      }
      const city = trimmed(params.city)
      if (city) body.city = city
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { geo: mapGeo(data) } }
  },

  outputs: {
    geo: { type: 'object', description: 'The created geo', properties: GEO_PROPERTIES },
  },
}
