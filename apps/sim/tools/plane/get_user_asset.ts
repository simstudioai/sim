import { PLANEV2USERASSETS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2UserAssetsSchema } from '@/tools/plane/schemas'
import type { PlaneGetUserAssetParams, PlaneGetUserAssetResponse } from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetUserAssetTool: ToolConfig<PlaneGetUserAssetParams, PlaneGetUserAssetResponse> =
  {
    id: 'plane_get_user_asset',
    name: 'Plane Get a user asset',
    description: 'Get a user asset in Plane. Requires API v2.',
    version: '1.0.0',
    params: {
      ...PLANE_CREDENTIAL_PARAMS,
      apiVersion: PLANE_VERSION_PARAM,
      pk: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The user asset id.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `asset_url`, `attributes`, `content_type`, `created_at`, `created_by_id`, `entity_type`, `id`, `is_uploaded`, `name`, `size`, `user_id`.',
      },
    },
    request: {
      url: (params) => {
        planeApiVersion(params.apiVersion, false)
        return planeApiUrl(
          params.baseUrl,
          `/api/v2/users/me/assets/${safeUrlPathSegment(params.pk, 'pk')}/`,
          planeVersionedValues(params, {
            fields: { key: 'fields', type: 'string', required: false },
          })
        )
      },
      method: 'GET',
      headers: (params) => planeHeaders(params.apiKey),
      redirectPolicy: planeRedirectPolicy,
      retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
    },
    transformResponse: async (response) => planeObjectResponse(response, planeV2UserAssetsSchema),
    outputs: { result: PLANEV2USERASSETS_OUTPUT },
  }
