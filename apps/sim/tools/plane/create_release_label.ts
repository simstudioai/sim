import { PLANEV2RELEASELABELS0DF496_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseLabels0df496Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateReleaseLabelParams,
  PlaneCreateReleaseLabelResponse,
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

export const planeCreateReleaseLabelTool: ToolConfig<
  PlaneCreateReleaseLabelParams,
  PlaneCreateReleaseLabelResponse
> = {
  id: 'plane_create_release_label',
  name: 'Plane Create a release label',
  description: 'Create a release label in Plane. Supports API v1 compatibility.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hex color used wherever this is rendered, for example `#3f76ff`. Maximum 255 characters.',
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
      description: 'v1 compatibility only. Sort order for the label. Defaults to 0.',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. ID of the project to scope the label to. When omitted, the label is workspace-wide. This cannot be changed after creation.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'name', 'color', 'v1_sort_order', 'project']
          : ['workspace_slug', 'name', 'color', 'sort_order', 'fields'],
        ['workspace_slug', 'name', 'color', 'sort_order', 'fields', 'v1_sort_order', 'project'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/labels/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/labels/`,
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
              color: { key: 'color', type: 'string', required: false },
              sort_order: { key: 'v1_sort_order', type: 'number', required: false },
              project: { key: 'project', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              color: { key: 'color', type: 'string', required: false },
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
