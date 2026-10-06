import {
  INITIATIVEF4AA07_OUTPUT,
  PLANEV2V2LISTINITIATIVESRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import { initiativef4aa07Schema, planeV2V2ListInitiativesresultSchema } from '@/tools/plane/schemas'
import type { PlaneListInitiativesParams, PlaneListInitiativesResponse } from '@/tools/plane/types'
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

export const planeListInitiativesTool: ToolConfig<
  PlaneListInitiativesParams,
  PlaneListInitiativesResponse
> = {
  id: 'plane_list_initiatives',
  name: 'Plane List initiatives',
  description: 'List initiatives in Plane. Supports API v1 compatibility.',
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
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
    },
    lead_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `lead_id`.',
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
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `DRAFT` - Draft - `PLANNED` - Planned - `ACTIVE` - Active - `COMPLETED` - Completed - `CLOSED` - Closed One of `ACTIVE`, `CLOSED`, `COMPLETED`, `DRAFT`, `PLANNED`.',
    },
    state__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Multiple values may be separated by commas. - `DRAFT` - Draft - `PLANNED` - Planned - `ACTIVE` - Active - `COMPLETED` - Completed - `CLOSED` - Closed',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `created_at`, `created_by_id`, `description`, `description_html`, `end_date`, `id`, `label_ids`, `lead_id`, `logo_props`, `name`, `project_ids`, `start_date`, `state`.",
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `lead`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
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
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'cursor', 'per_page']
          : [
              'workspace_slug',
              'count',
              'lead_id',
              'name',
              'offset',
              'order_by',
              'paginate',
              'per_page',
              'search',
              'state',
              'state__in',
              'fields',
              'expand',
              'cursor',
            ],
        [
          'workspace_slug',
          'count',
          'lead_id',
          'name',
          'offset',
          'order_by',
          'paginate',
          'per_page',
          'search',
          'state',
          'state__in',
          'fields',
          'expand',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/`,
            planeVersionedValues(params, {
              count: { key: 'count', type: 'boolean', required: false },
              lead_id: { key: 'lead_id', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              search: { key: 'search', type: 'string', required: false },
              state: { key: 'state', type: 'string', required: false },
              state__in: { key: 'state__in', type: 'array', required: false },
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
      ? planeListResponse(response, initiativef4aa07Schema, true, false)
      : planeObjectResponse(response, planeV2V2ListInitiativesresultSchema),
  outputs: {
    result: PLANEV2V2LISTINITIATIVESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: INITIATIVEF4AA07_OUTPUT.type,
        description: INITIATIVEF4AA07_OUTPUT.description,
        properties: INITIATIVEF4AA07_OUTPUT.properties,
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
