import { PLANEV2USERASSETS89DD1A_OUTPUT } from '@/tools/plane/outputs'
import { planeV2UserAssets89dd1aSchema } from '@/tools/plane/schemas'
import type { PlaneCreateUserAssetParams, PlaneCreateUserAssetResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
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

export const planeCreateUserAssetTool: ToolConfig<
  PlaneCreateUserAssetParams,
  PlaneCreateUserAssetResponse
> = {
  id: 'plane_create_user_asset',
  name: 'Plane Create a user asset upload',
  description: 'Create a user asset upload in Plane. Supports API v1 compatibility.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
    entity_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        '- `USER_AVATAR` - USER_AVATAR - `USER_COVER` - USER_COVER One of `USER_AVATAR`, `USER_COVER`.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name.',
    },
    size: { type: 'number', required: true, visibility: 'user-or-llm', description: 'The size.' },
    type: { type: 'string', required: false, visibility: 'user-or-llm', description: 'The type.' },
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
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['name', 'type', 'size', 'entity_type']
          : ['entity_type', 'name', 'size', 'type', 'fields'],
        ['entity_type', 'name', 'size', 'type', 'fields'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(params.baseUrl, `/api/v1/assets/user-assets/`)
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/users/me/assets/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              type: { key: 'type', type: 'string', required: false },
              size: { key: 'size', type: 'integer', required: true },
              entity_type: { key: 'entity_type', type: 'string', required: true },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              entity_type: { key: 'entity_type', type: 'string', required: true },
              name: { key: 'name', type: 'string', required: true },
              size: { key: 'size', type: 'integer', required: true },
              type: { key: 'type', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2UserAssets89dd1aSchema)
      : planeObjectResponse(response, planeV2UserAssets89dd1aSchema),
  outputs: { result: PLANEV2USERASSETS89DD1A_OUTPUT },
}
