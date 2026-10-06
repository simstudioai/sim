import { PLANEV2RELEASELABELS0DF496_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseLabels0df496Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateReleaseLabelParams,
  PlaneUpdateReleaseLabelResponse,
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

export const planeUpdateReleaseLabelTool: ToolConfig<
  PlaneUpdateReleaseLabelParams,
  PlaneUpdateReleaseLabelResponse
> = {
  id: 'plane_update_release_label',
  name: 'Plane Update a release label',
  description: 'Update a release label in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The release label id.',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hex color used wherever this is rendered, for example `#3f76ff`. Maximum 255 characters.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Manual ordering weight. Lower sorts first.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `color`, `created_at`, `created_by_id`, `id`, `name`, `sort_order`.',
    },
    v1_sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Sort order for the label.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'name', 'color', 'v1_sort_order']
          : ['workspace_slug', 'pk', 'color', 'name', 'sort_order', 'fields'],
        ['workspace_slug', 'pk', 'color', 'name', 'sort_order', 'fields', 'v1_sort_order'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/labels/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/labels/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
            {
              name: { key: 'name', type: 'string', required: false },
              color: { key: 'color', type: 'string', required: false },
              sort_order: { key: 'v1_sort_order', type: 'number', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              color: { key: 'color', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'integer', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2ReleaseLabels0df496Schema)
      : planeObjectResponse(response, planeV2ReleaseLabels0df496Schema),
  outputs: { result: PLANEV2RELEASELABELS0DF496_OUTPUT },
}
