import { PLANEV2V2GETCURRENTUSERRESULTBFF3BF_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2GetCurrentUserresultbff3bfSchema } from '@/tools/plane/schemas'
import type { PlaneGetCurrentUserParams, PlaneGetCurrentUserResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeGetCurrentUserTool: ToolConfig<
  PlaneGetCurrentUserParams,
  PlaneGetCurrentUserResponse
> = {
  id: 'plane_get_current_user',
  name: 'Plane Get current user',
  description: 'Get current user in Plane. Supports API v1 compatibility.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(params, version === 'v1' ? [] : [], [], version)
      return version === 'v1'
        ? planeApiUrl(params.baseUrl, `/api/v1/users/me/`)
        : planeApiUrl(params.baseUrl, `/api/v2/users/me/`)
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2V2GetCurrentUserresultbff3bfSchema)
      : planeObjectResponse(response, planeV2V2GetCurrentUserresultbff3bfSchema),
  outputs: { result: PLANEV2V2GETCURRENTUSERRESULTBFF3BF_OUTPUT },
}
