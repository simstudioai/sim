import { LABELB4435F_OUTPUT, PLANEV2V2LISTLABELSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { labelb4435fSchema, planeV2V2ListLabelsresultSchema } from '@/tools/plane/schemas'
import type { PlaneListLabelsParams, PlaneListLabelsResponse } from '@/tools/plane/types'
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

export const planeListLabelsTool: ToolConfig<PlaneListLabelsParams, PlaneListLabelsResponse> = {
  id: 'plane_list_labels',
  name: 'Plane List labels',
  description: 'List labels in Plane. Supports API v1 compatibility.',
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
      description: 'The project whose labels you want.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only the labels nested under this label. Pair it with `parent_id__isnull=true` to get the opposite view — every top-level label in the project. Use `parent_id__isnull=false` for every label that has a parent.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return labels whose `external_id` matches. Combine with `external_source` to resolve a record from another system to its Plane label without keeping a local id map.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return labels that came from this system, for example `github` or `jira`.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A search term matched against the label `name`. Use it to power type-ahead in a picker rather than downloading every page and filtering client-side.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to sort by. Prefix with `-` for descending. Defaults to `sort_order`. - `sort_order` , `-sort_order` — the project's own label ordering - `created_at` , `-created_at` — newest or oldest first - `id` , `-id` A value outside this list is not rejected — it silently falls back to the default `sort_order`. Check your spelling: a typo in `order_by` fails silently and shows up as a differently sorted page, not as an error.",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size. Defaults to 50, maximum 200.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of rows to skip from the start of the result set. Maximum 10000. Read the `next` value from the response and send it back as `offset` to walk forward.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` to switch from the default offset envelope to the keyset cursor envelope, which skips the `COUNT(*)` and returns `next_cursor` and `has_more` instead of `next` and `total_count`. Send the returned `next_cursor` back as `cursor` to fetch the following page. Only `created_at` and `id` are cursor-eligible, because a keyset needs a strictly ordered column and `sort_order` is neither unique nor monotonic. Pair `paginate=cursor` with `order_by=created_at` or `order_by=id` — the default `sort_order` ordering is rejected with `400 ordering_not_cursor_eligible`. Most projects have few enough labels that the default offset envelope is all you need.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `true`. Set to `false` to omit `total_count` and skip the count query.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `color`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `id`, `name`, `parent_id`, `sort_order`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
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
    parent_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'API v2: true selects top-level labels, false selects labels with a parent.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['project_id', 'workspace_slug', 'cursor', 'expand', 'fields', 'order_by', 'per_page']
          : [
              'workspace_slug',
              'project_id',
              'parent_id',
              'external_id',
              'external_source',
              'search',
              'order_by',
              'per_page',
              'offset',
              'paginate',
              'count',
              'fields',
              'cursor',
              'parent_id__isnull',
            ],
        [
          'workspace_slug',
          'project_id',
          'parent_id',
          'external_id',
          'external_source',
          'search',
          'order_by',
          'per_page',
          'offset',
          'paginate',
          'count',
          'fields',
          'cursor',
          'expand',
          'parent_id__isnull',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/labels/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/labels/`,
            planeVersionedValues(params, {
              parent_id: { key: 'parent_id', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              count: { key: 'count', type: 'boolean', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              cursor: { key: 'cursor', type: 'string', required: false },
              parent_id__isnull: { key: 'parent_id__isnull', type: 'boolean', required: false },
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
      ? planeListResponse(response, labelb4435fSchema, true, false)
      : planeObjectResponse(response, planeV2V2ListLabelsresultSchema),
  outputs: {
    result: PLANEV2V2LISTLABELSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: LABELB4435F_OUTPUT.type,
        description: LABELB4435F_OUTPUT.description,
        properties: LABELB4435F_OUTPUT.properties,
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
