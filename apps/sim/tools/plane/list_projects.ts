import { PLANEV2V2LISTPROJECTSRESULT_OUTPUT, PROJECT26B734_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListProjectsresultSchema, project26b734Schema } from '@/tools/plane/schemas'
import type { PlaneListProjectsParams, PlaneListProjectsResponse } from '@/tools/plane/types'
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

export const planeListProjectsTool: ToolConfig<PlaneListProjectsParams, PlaneListProjectsResponse> =
  {
    id: 'plane_list_projects',
    name: 'Plane List projects',
    description: 'List projects in Plane. Supports API v1 compatibility.',
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
      identifier: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `identifier`.',
      },
      include_archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `include_archived`.',
      },
      is_archived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `is_archived`.',
      },
      key: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `key`.',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `name`.',
      },
      network: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by `network`.',
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
      priority: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          '- `none` - None - `low` - Low - `medium` - Medium - `high` - High - `urgent` - Urgent One of `high`, `low`, `medium`, `none`, `urgent`.',
      },
      priority__in: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Multiple values may be separated by commas. - `none` - None - `low` - Low - `medium` - Medium - `high` - High - `urgent` - Urgent',
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
          "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archive_in`, `archived_at`, `close_in`, `cover_image`, `cover_image_url`, `created_at`, `created_by_id`, `cycle_view`, `default_assignee_id`, `default_state_id`, `description`, `emoji`, `estimate_id`, `external_id`, `external_source`, `guest_view_all_features`, `icon_prop`, `id`, `identifier`, `intake_view`, `is_issue_type_enabled`, `is_time_tracking_enabled`, `issue_views_view`, `logo_props`, `module_view`, `name`, `network`, `page_view`, `priority`, `project_lead_id`, `start_date`, `state_id`, `target_date`, `timezone`.",
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated relations to embed: `default_assignee`, `project_lead`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
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
                'workspace_slug',
                'cursor',
                'expand',
                'fields',
                'order_by',
                'per_page',
                'external_id',
                'external_source',
              ]
            : [
                'workspace_slug',
                'count',
                'external_id',
                'external_source',
                'identifier',
                'include_archived',
                'is_archived',
                'key',
                'name',
                'network',
                'offset',
                'order_by',
                'paginate',
                'per_page',
                'priority',
                'priority__in',
                'search',
                'fields',
                'expand',
                'cursor',
              ],
          [
            'workspace_slug',
            'count',
            'external_id',
            'external_source',
            'identifier',
            'include_archived',
            'is_archived',
            'key',
            'name',
            'network',
            'offset',
            'order_by',
            'paginate',
            'per_page',
            'priority',
            'priority__in',
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
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/`,
              planeVersionedValues(params, {
                cursor: { key: 'cursor', type: 'string', required: false },
                expand: { key: 'expand', type: 'string', required: false },
                fields: { key: 'fields', type: 'string', required: false },
                order_by: { key: 'order_by', type: 'string', required: false },
                per_page: { key: 'per_page', type: 'integer', required: false },
                external_id: { key: 'external_id', type: 'string', required: false },
                external_source: { key: 'external_source', type: 'string', required: false },
              })
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/`,
              planeVersionedValues(params, {
                count: { key: 'count', type: 'boolean', required: false },
                external_id: { key: 'external_id', type: 'string', required: false },
                external_source: { key: 'external_source', type: 'string', required: false },
                identifier: { key: 'identifier', type: 'string', required: false },
                include_archived: { key: 'include_archived', type: 'boolean', required: false },
                is_archived: { key: 'is_archived', type: 'boolean', required: false },
                key: { key: 'key', type: 'string', required: false },
                name: { key: 'name', type: 'string', required: false },
                network: { key: 'network', type: 'integer', required: false },
                offset: { key: 'offset', type: 'integer', required: false },
                order_by: { key: 'order_by', type: 'string', required: false },
                paginate: { key: 'paginate', type: 'string', required: false },
                per_page: { key: 'per_page', type: 'integer', required: false },
                priority: { key: 'priority', type: 'string', required: false },
                priority__in: { key: 'priority__in', type: 'array', required: false },
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
        ? planeListResponse(response, project26b734Schema, true, false)
        : planeObjectResponse(response, planeV2V2ListProjectsresultSchema),
    outputs: {
      result: PLANEV2V2LISTPROJECTSRESULT_OUTPUT,
      results: {
        type: 'array',
        optional: true,
        description: 'Returned Plane records.',
        items: {
          type: PROJECT26B734_OUTPUT.type,
          description: PROJECT26B734_OUTPUT.description,
          properties: PROJECT26B734_OUTPUT.properties,
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
