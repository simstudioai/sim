import type { PlaneDeleteUserAssetParams, PlaneDeleteUserAssetResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeleteUserAssetTool: ToolConfig<
  PlaneDeleteUserAssetParams,
  PlaneDeleteUserAssetResponse
> = {
  id: 'plane_delete_user_asset',
  name: 'Plane Delete a user asset',
  description: 'Delete a user asset in Plane. Supports API v1 compatibility.',
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
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1' ? ['pk'] : ['pk', 'fields'],
        ['pk', 'fields'],
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
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (_response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? { success: true, output: { success: true } }
      : { success: true, output: { success: true } },
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
