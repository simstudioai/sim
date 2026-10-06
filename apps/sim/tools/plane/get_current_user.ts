import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneGetCurrentUserParams, PlaneUserResponse } from '@/tools/plane/types'
import {
  mapPlaneUser,
  PLANE_CONNECTION_PARAMS,
  PLANE_USER_PROPERTIES,
  planeApiUrl,
  planeHeaders,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeGetCurrentUserTool: ToolConfig<PlaneGetCurrentUserParams, PlaneUserResponse> = {
  id: 'plane_get_current_user',
  name: 'Plane Get Current User',
  description: 'Get the Plane user that owns the API key',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    apiKey: PLANE_CONNECTION_PARAMS.apiKey,
    baseUrl: PLANE_CONNECTION_PARAMS.baseUrl,
  },

  request: {
    url: (params) => planeApiUrl(params.baseUrl, 'users/me/'),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { user: mapPlaneUser(data) } }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The authenticated user',
      properties: PLANE_USER_PROPERTIES,
    },
  },
}
