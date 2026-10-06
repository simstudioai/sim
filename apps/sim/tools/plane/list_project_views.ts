import { PLANEV2V2LISTPROJECTVIEWSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListProjectViewsresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneListProjectViewsParams,
  PlaneListProjectViewsResponse,
} from '@/tools/plane/types'
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

export const planeListProjectViewsTool: ToolConfig<
  PlaneListProjectViewsParams,
  PlaneListProjectViewsResponse
> = {
  id: 'plane_list_project_views',
  name: 'Plane List project views',
  description: 'List project views in Plane. Requires API v2.',
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
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    access: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: '- `0` - Private - `1` - Public One of `0`, `1`.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
    },
    is_locked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_locked`.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `name`.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip from the start of the result set.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to order the list by. Prefix with '-' for descending (e.g. '-created_at'). Annotation-backed orders sort semantically and ride the default offset page.",
    },
    owned_by_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `owned_by_id`.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Set to 'cursor' to opt into the COUNT-free keyset cursor envelope (use for deep traversal); omit for the default offset envelope with total_count. One of `cursor`.",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size (max 200).',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A search term.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `archived_at`, `created_at`, `created_by_id`, `description`, `display_filters`, `display_properties`, `filters`, `id`, `is_locked`, `logo_props`, `name`, `owned_by_id`, `pql_filters`, `query`, `sort_order`.",
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/views/`,
        planeVersionedValues(params, {
          access: { key: 'access', type: 'integer', required: false },
          count: { key: 'count', type: 'boolean', required: false },
          is_locked: { key: 'is_locked', type: 'boolean', required: false },
          name: { key: 'name', type: 'string', required: false },
          offset: { key: 'offset', type: 'integer', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
          owned_by_id: { key: 'owned_by_id', type: 'string', required: false },
          paginate: { key: 'paginate', type: 'string', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
          search: { key: 'search', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
          expand: { key: 'expand', type: 'string', required: false },
          cursor: { key: 'cursor', type: 'string', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2ListProjectViewsresultSchema),
  outputs: { result: PLANEV2V2LISTPROJECTVIEWSRESULT_OUTPUT },
}
