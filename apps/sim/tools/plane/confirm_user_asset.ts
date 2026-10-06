import { PLANEV2USERASSETS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2UserAssetsSchema } from '@/tools/plane/schemas'
import type {
  PlaneConfirmUserAssetParams,
  PlaneConfirmUserAssetResponse,
} from '@/tools/plane/types'
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
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeConfirmUserAssetTool: ToolConfig<
  PlaneConfirmUserAssetParams,
  PlaneConfirmUserAssetResponse
> = {
  id: 'plane_confirm_user_asset',
  name: 'Plane Confirm a user asset upload',
  description: 'Confirm a user asset upload in Plane. Supports API v1 compatibility.',
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
    attributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Additional attributes to update for the asset',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1' ? ['pk', 'attributes'] : ['pk', 'fields'],
        ['pk', 'fields', 'attributes'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/assets/user-assets/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/users/me/assets/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            { attributes: { key: 'attributes', type: 'object', required: false } },
            params.bodyOverrides
          )
        : planeVersionedValues(params, {}, params.bodyOverrides),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? { success: true, output: { success: true } }
      : planeObjectResponse(response, planeV2UserAssetsSchema),
  outputs: {
    result: PLANEV2USERASSETS_OUTPUT,
    success: { type: 'boolean', description: 'Operation completed successfully.' },
  },
}
