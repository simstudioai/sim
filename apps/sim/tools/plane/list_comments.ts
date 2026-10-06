import {
  PLANEV2V2LISTCOMMENTSRESULT_OUTPUT,
  WORKITEMCOMMENTA652FE_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ListCommentsresultSchema,
  workItemCommenta652feSchema,
} from '@/tools/plane/schemas'
import type { PlaneListCommentsParams, PlaneListCommentsResponse } from '@/tools/plane/types'
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

export const planeListCommentsTool: ToolConfig<PlaneListCommentsParams, PlaneListCommentsResponse> =
  {
    id: 'plane_list_comments',
    name: 'Plane List comments',
    description: 'List comments in Plane. Supports API v1 compatibility.',
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
        description: 'The project the work item belongs to.',
      },
      work_item_id: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'The work item whose comments you want. Comments never span work items, so this narrows the result set by itself.',
      },
      access: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Return only comments with this visibility. - `INTERNAL` — visible to the project team - `EXTERNAL` — marked as visible outside the team',
      },
      external_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Return comments carrying this identifier from your system. `external_id` is not a unique key, so this can match more than one comment — pair it with `external_source` and handle a multi-row result.',
      },
      external_source: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Return comments that came from this system, for example `github` or `zendesk`.',
      },
      search: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Match comments against their plain-text body (`comment_stripped`), so HTML markup in `comment_html` never affects whether a term hits.',
      },
      order_by: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Field to sort by. Prefix with `-` for descending. Send it explicitly whenever order matters — a thread you render should not depend on the server's unstated default. - `created_at` — oldest first - `-created_at` — newest first - `id` - `-id`",
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
          'Number of rows to skip from the start of the result set. Maximum 10000 — for deeper traversal switch to cursor pagination.',
      },
      paginate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Set to `cursor` to opt into the COUNT-free keyset envelope instead of the default offset envelope. The response then carries `next_cursor` and `has_more`; send the value of `next_cursor` back as `?cursor=` to fetch the next page. See [Pagination](https://developers.plane.so/api-reference/v2/pagination) for the full envelope.',
      },
      count: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Defaults to `true`. Set to `false` to skip the `COUNT(*)` and omit `total_count` from the offset envelope.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `access`, `actor_id`, `comment_html`, `comment_stripped`, `created_at`, `created_by_id`, `edited_at`, `external_id`, `external_source`, `id`, `work_item_id`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated relations to embed alongside the ids: `actor` (the comment author). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
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
            ? [
                'work_item_id',
                'project_id',
                'workspace_slug',
                'cursor',
                'expand',
                'fields',
                'order_by',
                'per_page',
              ]
            : [
                'workspace_slug',
                'project_id',
                'work_item_id',
                'access',
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
            'work_item_id',
            'access',
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
          version
        )
        return version === 'v1'
          ? planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/comments/`,
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
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/comments/`,
              planeVersionedValues(params, {
                access: { key: 'access', type: 'string', required: false },
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
        ? planeListResponse(response, workItemCommenta652feSchema, true, false)
        : planeObjectResponse(response, planeV2V2ListCommentsresultSchema),
    outputs: {
      result: PLANEV2V2LISTCOMMENTSRESULT_OUTPUT,
      results: {
        type: 'array',
        optional: true,
        description: 'Returned Plane records.',
        items: {
          type: WORKITEMCOMMENTA652FE_OUTPUT.type,
          description: WORKITEMCOMMENTA652FE_OUTPUT.description,
          properties: WORKITEMCOMMENTA652FE_OUTPUT.properties,
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
