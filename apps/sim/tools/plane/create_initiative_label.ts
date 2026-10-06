import { PLANEV2INITIATIVELABELSC1E575_OUTPUT } from '@/tools/plane/outputs'
import { planeV2InitiativeLabelsc1e575Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateInitiativeLabelParams,
  PlaneCreateInitiativeLabelResponse,
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

export const planeCreateInitiativeLabelTool: ToolConfig<
  PlaneCreateInitiativeLabelParams,
  PlaneCreateInitiativeLabelResponse
> = {
  id: 'plane_create_initiative_label',
  name: 'Plane Create an initiative label',
  description: 'Create an initiative label in Plane. Supports API v1 compatibility.',
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description.',
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
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `color`, `created_at`, `created_by_id`, `description`, `id`, `name`, `sort_order`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'name', 'description', 'color', 'sort_order']
          : ['workspace_slug', 'name', 'color', 'description', 'sort_order', 'fields'],
        ['workspace_slug', 'name', 'color', 'description', 'sort_order', 'fields'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/labels/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/labels/`,
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
              description: { key: 'description', type: 'string', required: false },
              color: { key: 'color', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              color: { key: 'color', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2InitiativeLabelsc1e575Schema)
      : planeObjectResponse(response, planeV2InitiativeLabelsc1e575Schema),
  outputs: { result: PLANEV2INITIATIVELABELSC1E575_OUTPUT },
}
