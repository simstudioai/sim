import { MODULEB27E64_OUTPUT, PLANEV2V2LISTMODULESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { moduleb27e64Schema, planeV2V2ListModulesresultSchema } from '@/tools/plane/schemas'
import type { PlaneListModulesParams, PlaneListModulesResponse } from '@/tools/plane/types'
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

export const planeListModulesTool: ToolConfig<PlaneListModulesParams, PlaneListModulesResponse> = {
  id: 'plane_list_modules',
  name: 'Plane List modules',
  description: 'List modules in Plane. Supports API v1 compatibility.',
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
      description: 'The project whose modules you want.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only modules in this lifecycle position. One of `backlog`, `planned`, `in-progress`, `paused`, `completed`, or `cancelled`. Use `status__in` with a comma-separated list to match several at once, for example `?status__in=planned,in-progress`.',
    },
    lead_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Return only modules led by this user. Match is exact on the module's `lead_id`.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only modules carrying this external identifier. Pair it with `external_source` to resolve a record you imported from another system.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only modules that came from this system, for example `github` or `jira`.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text match on the module name.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by. Prefix with `-` for descending. - `sort_order` , `-sort_order` - `created_at` , `-created_at` - `id` , `-id` Defaults to `sort_order`.',
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
        'Number of rows to skip from the start of the result set. Maximum 10000 — go deeper with cursor pagination.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` to opt into the COUNT-free keyset envelope, then follow `next_cursor` with `?cursor=`.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `false` to skip the count query and omit `total_count` from the offset envelope. Defaults to `true`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `id`, `lead_id`, `logo_props`, `member_ids`, `name`, `sort_order`, `start_date`, `status`, `target_date`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    status__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Return only modules in this lifecycle position. One of `backlog`, `planned`, `in-progress`, `paused`, `completed`, or `cancelled`. Use `status__in` with a comma-separated list to match several at once, for example `?status__in=planned,in-progress`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed alongside the ids: `lead` (the module lead), `members` (the module members). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
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
          ? ['project_id', 'workspace_slug', 'cursor', 'expand', 'fields', 'order_by', 'per_page']
          : [
              'workspace_slug',
              'project_id',
              'status',
              'lead_id',
              'external_id',
              'external_source',
              'search',
              'order_by',
              'per_page',
              'offset',
              'paginate',
              'count',
              'fields',
              'status__in',
              'expand',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'status',
          'lead_id',
          'external_id',
          'external_source',
          'search',
          'order_by',
          'per_page',
          'offset',
          'paginate',
          'count',
          'fields',
          'status__in',
          'expand',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/`,
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
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/`,
            planeVersionedValues(params, {
              status: { key: 'status', type: 'string', required: false },
              lead_id: { key: 'lead_id', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              count: { key: 'count', type: 'boolean', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              status__in: { key: 'status__in', type: 'string', required: false },
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
      ? planeListResponse(response, moduleb27e64Schema, true, false)
      : planeObjectResponse(response, planeV2V2ListModulesresultSchema),
  outputs: {
    result: PLANEV2V2LISTMODULESRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: MODULEB27E64_OUTPUT.type,
        description: MODULEB27E64_OUTPUT.description,
        properties: MODULEB27E64_OUTPUT.properties,
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
