import {
  PLANEV2V2LISTWORKLOGSRESULT_OUTPUT,
  WORKITEMWORKLOG7CF3B8_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ListWorklogsresultSchema,
  workItemWorkLog7cf3b8Schema,
} from '@/tools/plane/schemas'
import type { PlaneListWorklogsParams, PlaneListWorklogsResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
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

export const planeListWorklogsTool: ToolConfig<PlaneListWorklogsParams, PlaneListWorklogsResponse> =
  {
    id: 'plane_list_worklogs',
    name: 'Plane List worklogs',
    description: 'List worklogs in Plane. Supports API v1 compatibility.',
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
      work_item_id: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'The work item the resource hangs off. Accepts the work item UUID or its `PROJ-123` identifier.',
      },
      count: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
      },
      duration__gte: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `duration__gte`.',
      },
      duration__lte: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `duration__lte`.',
      },
      logged_by_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `logged_by_id`.',
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
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description`, `duration`, `id`, `logged_by_id`, `updated_at`, `work_item_id`.",
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated relations to embed: `logged_by`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
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
            ? ['work_item_id', 'project_id', 'workspace_slug']
            : [
                'workspace_slug',
                'project_id',
                'work_item_id',
                'count',
                'duration__gte',
                'duration__lte',
                'logged_by_id',
                'offset',
                'order_by',
                'paginate',
                'per_page',
                'search',
                'fields',
                'expand',
                'cursor',
              ],
          [
            'workspace_slug',
            'project_id',
            'work_item_id',
            'count',
            'duration__gte',
            'duration__lte',
            'logged_by_id',
            'offset',
            'order_by',
            'paginate',
            'per_page',
            'search',
            'fields',
            'expand',
            'cursor',
          ],
          version
        )
        return version === 'v1'
          ? planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/worklogs/`
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/worklogs/`,
              planeVersionedValues(params, {
                count: { key: 'count', type: 'boolean', required: false },
                duration__gte: { key: 'duration__gte', type: 'integer', required: false },
                duration__lte: { key: 'duration__lte', type: 'integer', required: false },
                logged_by_id: { key: 'logged_by_id', type: 'string', required: false },
                offset: { key: 'offset', type: 'integer', required: false },
                order_by: { key: 'order_by', type: 'string', required: false },
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
    transformResponse: async (response, params) =>
      planeApiVersion(params?.apiVersion, true) === 'v1'
        ? planeListResponse(response, workItemWorkLog7cf3b8Schema, false, false)
        : planeObjectResponse(response, planeV2V2ListWorklogsresultSchema),
    outputs: {
      result: PLANEV2V2LISTWORKLOGSRESULT_OUTPUT,
      results: {
        type: 'array',
        optional: true,
        description: 'Returned Plane records.',
        items: {
          type: WORKITEMWORKLOG7CF3B8_OUTPUT.type,
          description: WORKITEMWORKLOG7CF3B8_OUTPUT.description,
          properties: WORKITEMWORKLOG7CF3B8_OUTPUT.properties,
        },
      },
      detail: {
        type: 'string',
        optional: true,
        description: 'Provider message when no records are returned.',
      },
    },
  }
