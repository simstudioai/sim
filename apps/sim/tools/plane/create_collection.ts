import { PLANEV2COLLECTIONS2745F2_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Collections2745f2Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateCollectionParams,
  PlaneCreateCollectionResponse,
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

export const planeCreateCollectionTool: ToolConfig<
  PlaneCreateCollectionParams,
  PlaneCreateCollectionResponse
> = {
  id: 'plane_create_collection',
  name: 'Plane Create a collection',
  description: 'Create a collection in Plane. Supports API v1 compatibility.',
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
    access: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can see this.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Make this the default for its parent. Setting it clears the flag on the previous default.',
    },
    is_global: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this lives at the workspace level rather than inside a project.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name.',
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
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `created_at`, `created_by_id`, `id`, `is_default`, `is_global`, `logo_props`, `name`, `owned_by_id`, `page_ids`, `sort_order`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    v1_access: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. `0` for public (default) or `1` for private.',
    },
    v1_logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Logo or emoji properties. Defaults to an empty object.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'name', 'v1_access', 'v1_logo_props']
          : [
              'workspace_slug',
              'access',
              'is_default',
              'is_global',
              'logo_props',
              'name',
              'sort_order',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'access',
          'is_default',
          'is_global',
          'logo_props',
          'name',
          'sort_order',
          'fields',
          'expand',
          'v1_access',
          'v1_logo_props',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
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
              name: { key: 'name', type: 'string', required: false },
              access: { key: 'v1_access', type: 'integer', required: false },
              logo_props: { key: 'v1_logo_props', type: 'object', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              access: { key: 'access', type: 'string', required: false },
              is_default: { key: 'is_default', type: 'boolean', required: false },
              is_global: { key: 'is_global', type: 'boolean', required: false },
              logo_props: { key: 'logo_props', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Collections2745f2Schema)
      : planeObjectResponse(response, planeV2Collections2745f2Schema),
  outputs: { result: PLANEV2COLLECTIONS2745F2_OUTPUT },
}
