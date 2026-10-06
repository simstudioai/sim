import {
  INTAKEWORKITEM108B7F_OUTPUT,
  PLANEV2V2LISTINTAKEWORKITEMSRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  intakeWorkItem108b7fSchema,
  planeV2V2ListIntakeWorkItemsresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneListIntakeWorkItemsParams,
  PlaneListIntakeWorkItemsResponse,
} from '@/tools/plane/types'
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

export const planeListIntakeWorkItemsTool: ToolConfig<
  PlaneListIntakeWorkItemsParams,
  PlaneListIntakeWorkItemsResponse
> = {
  id: 'plane_list_intake_work_items',
  name: 'Plane List intake work items',
  description: 'List intake work items in Plane. Supports API v1 compatibility.',
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
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `external_id`.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `external_source`.',
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
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `source`.',
    },
    status: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `-2` - Pending - `-1` - Rejected - `0` - Snoozed - `1` - Accepted - `2` - Duplicate One of `-1`, `-2`, `0`, `1`, `2`.',
    },
    status__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Multiple values may be separated by commas. - `-2` - Pending - `-1` - Rejected - `0` - Snoozed - `1` - Accepted - `2` - Duplicate',
    },
    work_item_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `work_item_id`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description_html`, `duplicate_to_id`, `external_id`, `external_source`, `id`, `intake_id`, `name`, `priority`, `snoozed_till`, `source`, `source_email`, `state_id`, `status`, `work_item_id`.",
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
        'v1 compatibility only. Comma-separated list of related fields to expand in response',
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
              'expand',
              'fields',
              'per_page',
              'external_id',
              'external_source',
              'order_by',
            ]
          : [
              'workspace_slug',
              'project_id',
              'count',
              'external_id',
              'external_source',
              'offset',
              'order_by',
              'paginate',
              'per_page',
              'search',
              'source',
              'status',
              'status__in',
              'work_item_id',
              'fields',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'count',
          'external_id',
          'external_source',
          'offset',
          'order_by',
          'paginate',
          'per_page',
          'search',
          'source',
          'status',
          'status__in',
          'work_item_id',
          'fields',
          'cursor',
          'expand',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/intake-issues/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/intake-issues/`,
            planeVersionedValues(params, {
              count: { key: 'count', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              search: { key: 'search', type: 'string', required: false },
              source: { key: 'source', type: 'string', required: false },
              status: { key: 'status', type: 'integer', required: false },
              status__in: { key: 'status__in', type: 'array', required: false },
              work_item_id: { key: 'work_item_id', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
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
      ? planeListResponse(response, intakeWorkItem108b7fSchema, true, false)
      : planeObjectResponse(response, planeV2V2ListIntakeWorkItemsresultSchema),
  outputs: {
    result: PLANEV2V2LISTINTAKEWORKITEMSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: INTAKEWORKITEM108B7F_OUTPUT.type,
        description: INTAKEWORKITEM108B7F_OUTPUT.description,
        properties: INTAKEWORKITEM108B7F_OUTPUT.properties,
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
