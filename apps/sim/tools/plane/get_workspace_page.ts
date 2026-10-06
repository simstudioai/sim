import { PLANEV2WORKSPACEPAGESC8362F_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspacePagesc8362fSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkspacePageParams,
  PlaneGetWorkspacePageResponse,
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

export const planeGetWorkspacePageTool: ToolConfig<
  PlaneGetWorkspacePageParams,
  PlaneGetWorkspacePageResponse
> = {
  id: 'plane_get_workspace_page',
  name: 'Plane Get a workspace page',
  description: 'Get a workspace page in Plane. Supports API v1 compatibility.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
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
      description: 'The workspace page id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `archived_at`, `collection_id`, `color`, `created_at`, `created_by_id`, `description_html`, `description_stripped`, `external_id`, `external_source`, `id`, `is_global`, `is_locked`, `logo_props`, `name`, `owned_by_id`, `parent_id`, `sort_order`, `view_props`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`, `parent`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. External system identifier for filtering or lookup',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. External system source name for filtering or lookup',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "v1 compatibility only. Field to order results by. Prefix with '-' for descending order",
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'pk',
              'workspace_slug',
              'expand',
              'fields',
              'external_id',
              'external_source',
              'order_by',
            ]
          : ['workspace_slug', 'pk', 'fields', 'expand'],
        ['workspace_slug', 'pk', 'fields', 'expand', 'external_id', 'external_source', 'order_by'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
            })
          )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkspacePagesc8362fSchema)
      : planeObjectResponse(response, planeV2WorkspacePagesc8362fSchema),
  outputs: { result: PLANEV2WORKSPACEPAGESC8362F_OUTPUT },
}
