import { CYCLE857A4C_OUTPUT, PLANEV2V2LISTCYCLESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { cycle857a4cSchema, planeV2V2ListCyclesresultSchema } from '@/tools/plane/schemas'
import type { PlaneListCyclesParams, PlaneListCyclesResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_PAGINATION_OUTPUT,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeListCyclesTool: ToolConfig<PlaneListCyclesParams, PlaneListCyclesResponse> = {
  id: 'plane_list_cycles',
  name: 'Plane List cycles',
  description: 'List cycles in Plane. Supports API v1 compatibility.',
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
      description: 'The project whose cycles you want.',
    },
    owned_by_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only cycles owned by this user. This is how you build a "my cycles" view — pass the authenticated user\'s id. Ownership is assigned by Plane, so this is a read-side filter only.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only cycles whose `external_id` matches exactly. Pair it with `external_source` when the same identifier could come from more than one system.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only cycles imported from this source, for example `jira`.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search term matched against the cycle.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to sort by. Prefix with `-` for descending. - `sort_order` / `-sort_order` — the project's manual cycle ordering - `created_at` / `-created_at` — newest or oldest first - `id` / `-id`",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size. Maximum 200 for API v2 and 100 for API v1.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of rows to skip from the start of the result set. Maximum 10000 — past that, switch to cursor pagination.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` to opt into the COUNT-free keyset envelope instead of the default offset envelope. The response then carries `next_cursor` and `has_more` rather than `next`, `previous`, and `total_count`; pass `next_cursor` back as `cursor` to walk to the following page. Use it for deep traversal, where offset paging gets expensive.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `true`. Set to `false` to skip the `COUNT(*)` behind `total_count` — the field is then omitted from the envelope. Worth doing when you only need the rows.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `created_at`, `created_by_id`, `description`, `end_date`, `external_id`, `external_source`, `id`, `logo_props`, `name`, `owned_by_id`, `sort_order`, `start_date`, `timezone`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed alongside the ids: `owned_by` (the cycle owner). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
    },
    cycle_view: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Filter cycles by status',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'project_id',
              'workspace_slug',
              'cursor',
              'cycle_view',
              'expand',
              'fields',
              'order_by',
              'per_page',
            ]
          : [
              'workspace_slug',
              'project_id',
              'owned_by_id',
              'external_id',
              'external_source',
              'search',
              'order_by',
              'per_page',
              'offset',
              'paginate',
              'count',
              'fields',
              'expand',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'owned_by_id',
          'external_id',
          'external_source',
          'search',
          'order_by',
          'per_page',
          'offset',
          'paginate',
          'count',
          'fields',
          'expand',
          'cursor',
          'cycle_view',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              cycle_view: { key: 'cycle_view', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/`,
            planeVersionedValues(params, {
              owned_by_id: { key: 'owned_by_id', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              count: { key: 'count', type: 'boolean', required: false },
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
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeListResponse(response, cycle857a4cSchema, true, false)
      : planeObjectResponse(response, planeV2V2ListCyclesresultSchema),
  outputs: {
    result: PLANEV2V2LISTCYCLESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: CYCLE857A4C_OUTPUT.type,
        description: CYCLE857A4C_OUTPUT.description,
        properties: CYCLE857A4C_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
    pagination: PLANE_PAGINATION_OUTPUT,
  },
}
