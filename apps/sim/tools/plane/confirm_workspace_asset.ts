import { PLANEV2WORKSPACEASSETS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceAssetsSchema } from '@/tools/plane/schemas'
import type {
  PlaneConfirmWorkspaceAssetParams,
  PlaneConfirmWorkspaceAssetResponse,
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

export const planeConfirmWorkspaceAssetTool: ToolConfig<
  PlaneConfirmWorkspaceAssetParams,
  PlaneConfirmWorkspaceAssetResponse
> = {
  id: 'plane_confirm_workspace_asset',
  name: 'Plane Confirm a workspace asset upload',
  description: 'Confirm a workspace asset upload in Plane. Supports API v1 compatibility.',
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
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    pk: { type: 'string', required: true, visibility: 'user-or-llm', description: 'The asset id.' },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `asset_url`, `attributes`, `content_type`, `created_at`, `created_by_id`, `entity_type`, `external_id`, `external_source`, `id`, `is_uploaded`, `name`, `size`.',
    },
    is_uploaded: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Whether the asset has been successfully uploaded',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['pk', 'workspace_slug', 'is_uploaded']
          : ['workspace_slug', 'pk', 'fields'],
        ['workspace_slug', 'pk', 'fields', 'is_uploaded'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/assets/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/assets/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
            { is_uploaded: { key: 'is_uploaded', type: 'boolean', required: false } },
            params.bodyOverrides
          )
        : planeVersionedValues(params, {}, params.bodyOverrides),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? { success: true, output: { success: true } }
      : planeObjectResponse(response, planeV2WorkspaceAssetsSchema),
  outputs: {
    result: PLANEV2WORKSPACEASSETS_OUTPUT,
    success: { type: 'boolean', description: 'Operation completed successfully.' },
  },
}
