import { PLANEV2V2LISTWORKSPACEWORKITEMSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListWorkspaceWorkItemsresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneListWorkspaceWorkItemsParams,
  PlaneListWorkspaceWorkItemsResponse,
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

export const planeListWorkspaceWorkItemsTool: ToolConfig<
  PlaneListWorkspaceWorkItemsParams,
  PlaneListWorkspaceWorkItemsResponse
> = {
  id: 'plane_list_workspace_work_items',
  name: 'Plane List work items across a workspace',
  description: 'List work items across a workspace in Plane. Requires API v2.',
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
    assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `assignee_id`.',
    },
    assignee_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    assignee_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `assignee_id__isnull`.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
    },
    created_at__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `created_at__gte`.',
    },
    created_at__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `created_at__lte`.',
    },
    cycle_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `cycle_id`.',
    },
    cycle_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    cycle_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `cycle_id__isnull`.',
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
    is_draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_draft`.',
    },
    label_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `label_id`.',
    },
    label_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    label_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `label_id__isnull`.',
    },
    module_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `module_id`.',
    },
    module_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    module_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `module_id__isnull`.',
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
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `parent_id`.',
    },
    parent_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    parent_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `parent_id__isnull`.',
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
        '- `urgent` - Urgent - `high` - High - `medium` - Medium - `low` - Low - `none` - None One of `high`, `low`, `medium`, `none`, `urgent`.',
    },
    priority__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Multiple values may be separated by commas. - `urgent` - Urgent - `high` - High - `medium` - Medium - `low` - Low - `none` - None',
    },
    project_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `project_id`.',
    },
    project_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A search term.',
    },
    sequence_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `sequence_id`.',
    },
    start_date__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `start_date__gte`.',
    },
    start_date__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `start_date__lte`.',
    },
    state_group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `backlog` - Backlog - `unstarted` - Unstarted - `started` - Started - `completed` - Completed - `cancelled` - Cancelled - `triage` - Triage One of `backlog`, `cancelled`, `completed`, `started`, `triage`, `unstarted`.',
    },
    state_group__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Multiple values may be separated by commas. - `backlog` - Backlog - `unstarted` - Unstarted - `started` - Started - `completed` - Completed - `cancelled` - Cancelled - `triage` - Triage',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `state_id`.',
    },
    state_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    target_date__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `target_date__gte`.',
    },
    target_date__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `target_date__lte`.',
    },
    type_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `type_id`.',
    },
    type_id__in: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple values may be separated by commas.',
    },
    updated_at__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `updated_at__gte`.',
    },
    updated_at__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `updated_at__lte`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `assignee_ids`, `created_at`, `created_by_id`, `cycle_id`, `id`, `identifier`, `is_draft`, `label_ids`, `module_ids`, `name`, `parent_id`, `priority`, `project_id`, `sequence_id`, `start_date`, `state_id`, `target_date`, `type_id`.",
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `assignees`, `cycle`, `labels`, `modules`, `parent`, `state`, `type`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-items/`,
        planeVersionedValues(params, {
          assignee_id: { key: 'assignee_id', type: 'string', required: false },
          assignee_id__in: { key: 'assignee_id__in', type: 'array', required: false },
          assignee_id__isnull: { key: 'assignee_id__isnull', type: 'boolean', required: false },
          count: { key: 'count', type: 'boolean', required: false },
          created_at__gte: { key: 'created_at__gte', type: 'string', required: false },
          created_at__lte: { key: 'created_at__lte', type: 'string', required: false },
          cycle_id: { key: 'cycle_id', type: 'string', required: false },
          cycle_id__in: { key: 'cycle_id__in', type: 'array', required: false },
          cycle_id__isnull: { key: 'cycle_id__isnull', type: 'boolean', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
          is_draft: { key: 'is_draft', type: 'boolean', required: false },
          label_id: { key: 'label_id', type: 'string', required: false },
          label_id__in: { key: 'label_id__in', type: 'array', required: false },
          label_id__isnull: { key: 'label_id__isnull', type: 'boolean', required: false },
          module_id: { key: 'module_id', type: 'string', required: false },
          module_id__in: { key: 'module_id__in', type: 'array', required: false },
          module_id__isnull: { key: 'module_id__isnull', type: 'boolean', required: false },
          offset: { key: 'offset', type: 'integer', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
          paginate: { key: 'paginate', type: 'string', required: false },
          parent_id: { key: 'parent_id', type: 'string', required: false },
          parent_id__in: { key: 'parent_id__in', type: 'array', required: false },
          parent_id__isnull: { key: 'parent_id__isnull', type: 'boolean', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
          priority: { key: 'priority', type: 'string', required: false },
          priority__in: { key: 'priority__in', type: 'array', required: false },
          project_id: { key: 'project_id', type: 'string', required: false },
          project_id__in: { key: 'project_id__in', type: 'array', required: false },
          search: { key: 'search', type: 'string', required: false },
          sequence_id: { key: 'sequence_id', type: 'integer', required: false },
          start_date__gte: { key: 'start_date__gte', type: 'string', required: false },
          start_date__lte: { key: 'start_date__lte', type: 'string', required: false },
          state_group: { key: 'state_group', type: 'string', required: false },
          state_group__in: { key: 'state_group__in', type: 'array', required: false },
          state_id: { key: 'state_id', type: 'string', required: false },
          state_id__in: { key: 'state_id__in', type: 'array', required: false },
          target_date__gte: { key: 'target_date__gte', type: 'string', required: false },
          target_date__lte: { key: 'target_date__lte', type: 'string', required: false },
          type_id: { key: 'type_id', type: 'string', required: false },
          type_id__in: { key: 'type_id__in', type: 'array', required: false },
          updated_at__gte: { key: 'updated_at__gte', type: 'string', required: false },
          updated_at__lte: { key: 'updated_at__lte', type: 'string', required: false },
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
    planeObjectResponse(response, planeV2V2ListWorkspaceWorkItemsresultSchema),
  outputs: { result: PLANEV2V2LISTWORKSPACEWORKITEMSRESULT_OUTPUT },
}
