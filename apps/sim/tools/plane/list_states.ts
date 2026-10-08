import { PLANEV2V2LISTSTATESRESULT_OUTPUT, STATE4B88AE_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListStatesresultSchema, state4b88aeSchema } from '@/tools/plane/schemas'
import type { PlaneListStatesParams, PlaneListStatesResponse } from '@/tools/plane/types'
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

export const planeListStatesTool: ToolConfig<PlaneListStatesParams, PlaneListStatesResponse> = {
  id: 'plane_list_states',
  name: 'Plane List states',
  description: 'List states in Plane. Supports API v1 compatibility.',
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
      description: 'The project whose states you want to list.',
    },
    group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only states in this workflow group. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, or `triage`. Use the `group__in` variant to match several groups at once, passing them comma-separated — `?group__in=started,completed`. Filtering by group is the portable way to ask "what counts as in progress here", because every project names its states differently but the groups are fixed.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Return only the project's default state (`true`) or only the non-default states (`false`). Pairing `?is_default=true` with `?per_page=1` is the cheapest way to find where new work items will land.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return states whose `external_id` matches exactly. Use it to find the state you previously created for a record in another system.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return states that came from a particular system, for example `github` or `jira`. Combine it with `external_id` — an `external_id` is only unique within its source.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A search term matched against the state name.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `color`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `group`, `id`, `is_default`, `is_triage`, `name`, `sequence`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    group__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Return only states in this workflow group. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, or `triage`. Use the `group__in` variant to match several groups at once, passing them comma-separated — `?group__in=started,completed`. Filtering by group is the portable way to ask "what counts as in progress here", because every project names its states differently but the groups are fixed.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to sort by. Prefix with `-` for descending. - `sequence` , `-sequence` — the project's own workflow order - `created_at` , `-created_at` — when each state was added - `id` , `-id` Order by `sequence` when you are rendering the workflow to a user; it is the order the project itself uses.",
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
        'Number of rows to skip from the start of the result set. Maximum 10000. Read the `next` value from the response rather than computing offsets yourself.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` to opt into the COUNT-free keyset envelope, which returns `next_cursor` and `has_more` instead of `next` and `total_count`. Omit it for the default offset envelope.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `true`. Set to `false` to skip the `COUNT(*)` behind `total_count`; the field is then omitted from the response.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Comma-separated list of related fields to expand in response Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['project_id', 'workspace_slug', 'cursor', 'expand', 'fields', 'per_page']
          : [
              'workspace_slug',
              'project_id',
              'group',
              'is_default',
              'external_id',
              'external_source',
              'search',
              'fields',
              'group__in',
              'order_by',
              'per_page',
              'offset',
              'paginate',
              'count',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'group',
          'is_default',
          'external_id',
          'external_source',
          'search',
          'fields',
          'group__in',
          'order_by',
          'per_page',
          'offset',
          'paginate',
          'count',
          'cursor',
          'expand',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/states/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/states/`,
            planeVersionedValues(params, {
              group: { key: 'group', type: 'string', required: false },
              is_default: { key: 'is_default', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              group__in: { key: 'group__in', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              count: { key: 'count', type: 'boolean', required: false },
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
      ? planeListResponse(response, state4b88aeSchema, true, false)
      : planeObjectResponse(response, planeV2V2ListStatesresultSchema),
  outputs: {
    result: PLANEV2V2LISTSTATESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: STATE4B88AE_OUTPUT.type,
        description: STATE4B88AE_OUTPUT.description,
        properties: STATE4B88AE_OUTPUT.properties,
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
