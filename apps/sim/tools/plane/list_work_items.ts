import { PLANEV2V2LISTWORKITEMSRESULT_OUTPUT, WORKITEMDC8A1D_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ListWorkItemsresultSchema, workItemdc8a1dSchema } from '@/tools/plane/schemas'
import type { PlaneListWorkItemsParams, PlaneListWorkItemsResponse } from '@/tools/plane/types'
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

export const planeListWorkItemsTool: ToolConfig<
  PlaneListWorkItemsParams,
  PlaneListWorkItemsResponse
> = {
  id: 'plane_list_work_items',
  name: 'Plane List work items',
  description: 'List work items in Plane. Supports API v1 compatibility.',
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
      description: 'The project to list work items from.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return on each row. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `assignee_ids`, `created_at`, `created_by_id`, `cycle_id`, `id`, `identifier`, `is_draft`, `label_ids`, `module_ids`, `name`, `parent_id`, `priority`, `project_id`, `sequence_id`, `start_date`, `state_id`, `target_date`, `type_id`. Naming `custom_fields` here is a `400` — it is only available on single-object responses. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match work items in a specific state. Use `state_id__in` with a comma-separated list to match any of several states.',
    },
    state_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match work items in a specific state. Use `state_id__in` with a comma-separated list to match any of several states.',
    },
    state_group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Match by the state's workflow group instead of a specific state — stable across projects that name their states differently. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, `triage`. Use `state_group__in` for several groups, for example `?state_group__in=started,completed`.",
    },
    state_group__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Documented filter variant. Match by the state's workflow group instead of a specific state — stable across projects that name their states differently. One of `backlog`, `unstarted`, `started`, `completed`, `cancelled`, `triage`. Use `state_group__in` for several groups, for example `?state_group__in=started,completed`.",
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'One of `urgent`, `high`, `medium`, `low`, `none`. Use `priority__in` for several, for example `?priority__in=urgent,high`.',
    },
    priority__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. One of `urgent`, `high`, `medium`, `low`, `none`. Use `priority__in` for several, for example `?priority__in=urgent,high`.',
    },
    assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match work items assigned to a user. `assignee_id__in` matches any of several users; `assignee_id__isnull=true` returns only unassigned work items.',
    },
    assignee_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match work items assigned to a user. `assignee_id__in` matches any of several users; `assignee_id__isnull=true` returns only unassigned work items.',
    },
    label_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match work items carrying a label. `label_id__in` matches any of several labels; `label_id__isnull=true` returns only unlabeled work items.',
    },
    label_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match work items carrying a label. `label_id__in` matches any of several labels; `label_id__isnull=true` returns only unlabeled work items.',
    },
    type_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match work items of a given work item type. `type_id__in` accepts a comma-separated list.',
    },
    type_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match work items of a given work item type. `type_id__in` accepts a comma-separated list.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match the children of a work item. `parent_id__in` accepts several parents; `parent_id__isnull=true` returns only top-level work items.',
    },
    parent_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match the children of a work item. `parent_id__in` accepts several parents; `parent_id__isnull=true` returns only top-level work items.',
    },
    cycle_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match work items in a cycle. `cycle_id__in` accepts several cycles; `cycle_id__isnull=true` returns the backlog of work items in no cycle at all.',
    },
    cycle_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match work items in a cycle. `cycle_id__in` accepts several cycles; `cycle_id__isnull=true` returns the backlog of work items in no cycle at all.',
    },
    module_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match work items in a module. `module_id__in` accepts several modules; `module_id__isnull=true` returns work items in no module.',
    },
    module_id__in: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented filter variant. Match work items in a module. `module_id__in` accepts several modules; `module_id__isnull=true` returns work items in no module.',
    },
    sequence_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Match the single work item with this number within the project — the `142` of `PROJ-142`.',
    },
    is_draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter drafts in or out. Drafts are work items still being composed in the Plane app.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Correlation filters for sync and import. `external_source` is the system a record came from and `external_id` is its key there, so the pair is how you find the Plane work item that mirrors a row in your own database. These values are not returned on reads — the lookup is one-way.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Correlation filters for sync and import. `external_source` is the system a record came from and `external_id` is its key there, so the pair is how you find the Plane work item that mirrors a row in your own database. These values are not returned on reads — the lookup is one-way.',
    },
    created_at__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bound the creation timestamp. Pass an ISO 8601 datetime, for example `2026-01-01T00:00:00Z`. Use both for a window.',
    },
    created_at__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bound the creation timestamp. Pass an ISO 8601 datetime, for example `2026-01-01T00:00:00Z`. Use both for a window.',
    },
    updated_at__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bound the last-modified timestamp. This is the pair to use for incremental sync — poll with `?updated_at__gte=&order_by=updated_at`. `updated_at` is filterable and orderable but is not part of the read shape, so it does not come back in the response body.',
    },
    updated_at__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bound the last-modified timestamp. This is the pair to use for incremental sync — poll with `?updated_at__gte=&order_by=updated_at`. `updated_at` is filterable and orderable but is not part of the read shape, so it does not come back in the response body.',
    },
    start_date__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bound the planned start date, for example `2026-01-01`.',
    },
    start_date__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bound the planned start date, for example `2026-01-01`.',
    },
    target_date__gte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bound the planned due date. `?target_date__lte=2026-01-31&state_group__in=backlog,unstarted,started` is the "what is about to slip" query.',
    },
    target_date__lte: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bound the planned due date. `?target_date__lte=2026-01-31&state_group__in=backlog,unstarted,started` is the "what is about to slip" query.',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search over the work item name.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by. Prefix with `-` for descending. Defaults to `-created_at`. - `created_at`, `-created_at` - `updated_at`, `-updated_at` - `sequence_id`, `-sequence_id` - `id`, `-id` - `sort_order`, `-sort_order` — the manual board ordering - `priority`, `-priority` — semantic: `urgent` → `high` → `medium` → `low` → `none`, not alphabetical - `state_group`, `-state_group` — semantic: workflow order, not alphabetical `priority` and `state_group` sort by meaning, which is what you want for a board but is not cursor-eligible. Pair either with `?paginate=cursor` and you get `400 ordering_not_cursor_eligible`; use the default offset pages instead.',
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
        'Rows to skip from the start of the result set. Maximum 10000 — past that, switch to cursor pagination.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `true`. Pass `?count=false` to skip the `COUNT(*)` and omit `total_count` from the envelope. Worth doing on large projects when you only need the rows.',
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `cursor` to opt into keyset pagination. The envelope changes to `next_cursor` / `has_more` and drops `total_count`. Use it for deep or long-running traversals where offset pages would drift as rows are inserted. Follow the returned `next_cursor` as described in [Pagination](https://developers.plane.so/api-reference/v2/pagination).',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated relations to embed alongside the ids: `assignees` (the assigned users), `cycle` (the cycle it belongs to), `labels` (the applied labels), `modules` (the modules it belongs to), `parent` (its parent work item), `state` (the work item's state object), `type` (its work item type). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.",
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
    },
    pql: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Plane Query Language expression. Human-readable alternative to `filters`. Example: `priority = "urgent" AND assignee = currentUser()`. Requires a Plane edition with work item query filtering; Community Edition rejects this parameter.',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Structured filter expression. Supports nested `and`/`or`/`not` groups and field comparisons with operators like `__in`, `__gte`, `__range`, `__isnull`, `__icontains`, etc. JSON-encoded into the `filters=` query param by the client. Requires a Plane edition with work item query filtering; Community Edition rejects this parameter.',
    },
    assignee_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'API v2: select records with a missing assignee when true, or a present assignee when false.',
    },
    label_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'API v2: select records with a missing label when true, or a present label when false.',
    },
    parent_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'API v2: select records with a missing parent when true, or a present parent when false.',
    },
    cycle_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'API v2: select records with a missing cycle when true, or a present cycle when false.',
    },
    module_id__isnull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'API v2: select records with a missing module when true, or a present module when false.',
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
              'external_id',
              'external_source',
              'fields',
              'order_by',
              'per_page',
              'pql',
              'filters',
            ]
          : [
              'workspace_slug',
              'project_id',
              'fields',
              'state_id',
              'state_id__in',
              'state_group',
              'state_group__in',
              'priority',
              'priority__in',
              'assignee_id',
              'assignee_id__in',
              'label_id',
              'label_id__in',
              'type_id',
              'type_id__in',
              'parent_id',
              'parent_id__in',
              'cycle_id',
              'cycle_id__in',
              'module_id',
              'module_id__in',
              'sequence_id',
              'is_draft',
              'external_id',
              'external_source',
              'created_at__gte',
              'created_at__lte',
              'updated_at__gte',
              'updated_at__lte',
              'start_date__gte',
              'start_date__lte',
              'target_date__gte',
              'target_date__lte',
              'search',
              'order_by',
              'per_page',
              'offset',
              'count',
              'paginate',
              'expand',
              'cursor',
              'assignee_id__isnull',
              'label_id__isnull',
              'parent_id__isnull',
              'cycle_id__isnull',
              'module_id__isnull',
            ],
        [
          'workspace_slug',
          'project_id',
          'fields',
          'state_id',
          'state_id__in',
          'state_group',
          'state_group__in',
          'priority',
          'priority__in',
          'assignee_id',
          'assignee_id__in',
          'label_id',
          'label_id__in',
          'type_id',
          'type_id__in',
          'parent_id',
          'parent_id__in',
          'cycle_id',
          'cycle_id__in',
          'module_id',
          'module_id__in',
          'sequence_id',
          'is_draft',
          'external_id',
          'external_source',
          'created_at__gte',
          'created_at__lte',
          'updated_at__gte',
          'updated_at__lte',
          'start_date__gte',
          'start_date__lte',
          'target_date__gte',
          'target_date__lte',
          'search',
          'order_by',
          'per_page',
          'offset',
          'count',
          'paginate',
          'expand',
          'cursor',
          'pql',
          'filters',
          'assignee_id__isnull',
          'label_id__isnull',
          'parent_id__isnull',
          'cycle_id__isnull',
          'module_id__isnull',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              pql: { key: 'pql', type: 'string', required: false },
              filters: { key: 'filters', type: 'object', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              state_id: { key: 'state_id', type: 'string', required: false },
              state_id__in: { key: 'state_id__in', type: 'string', required: false },
              state_group: { key: 'state_group', type: 'string', required: false },
              state_group__in: { key: 'state_group__in', type: 'string', required: false },
              priority: { key: 'priority', type: 'string', required: false },
              priority__in: { key: 'priority__in', type: 'string', required: false },
              assignee_id: { key: 'assignee_id', type: 'string', required: false },
              assignee_id__in: { key: 'assignee_id__in', type: 'string', required: false },
              label_id: { key: 'label_id', type: 'string', required: false },
              label_id__in: { key: 'label_id__in', type: 'string', required: false },
              type_id: { key: 'type_id', type: 'string', required: false },
              type_id__in: { key: 'type_id__in', type: 'string', required: false },
              parent_id: { key: 'parent_id', type: 'string', required: false },
              parent_id__in: { key: 'parent_id__in', type: 'string', required: false },
              cycle_id: { key: 'cycle_id', type: 'string', required: false },
              cycle_id__in: { key: 'cycle_id__in', type: 'string', required: false },
              module_id: { key: 'module_id', type: 'string', required: false },
              module_id__in: { key: 'module_id__in', type: 'string', required: false },
              sequence_id: { key: 'sequence_id', type: 'integer', required: false },
              is_draft: { key: 'is_draft', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              created_at__gte: { key: 'created_at__gte', type: 'string', required: false },
              created_at__lte: { key: 'created_at__lte', type: 'string', required: false },
              updated_at__gte: { key: 'updated_at__gte', type: 'string', required: false },
              updated_at__lte: { key: 'updated_at__lte', type: 'string', required: false },
              start_date__gte: { key: 'start_date__gte', type: 'string', required: false },
              start_date__lte: { key: 'start_date__lte', type: 'string', required: false },
              target_date__gte: { key: 'target_date__gte', type: 'string', required: false },
              target_date__lte: { key: 'target_date__lte', type: 'string', required: false },
              search: { key: 'search', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              count: { key: 'count', type: 'boolean', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              cursor: { key: 'cursor', type: 'string', required: false },
              assignee_id__isnull: { key: 'assignee_id__isnull', type: 'boolean', required: false },
              label_id__isnull: { key: 'label_id__isnull', type: 'boolean', required: false },
              parent_id__isnull: { key: 'parent_id__isnull', type: 'boolean', required: false },
              cycle_id__isnull: { key: 'cycle_id__isnull', type: 'boolean', required: false },
              module_id__isnull: { key: 'module_id__isnull', type: 'boolean', required: false },
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
      ? planeListResponse(response, workItemdc8a1dSchema, true, false)
      : planeObjectResponse(response, planeV2V2ListWorkItemsresultSchema),
  outputs: {
    result: PLANEV2V2LISTWORKITEMSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: WORKITEMDC8A1D_OUTPUT.type,
        description: WORKITEMDC8A1D_OUTPUT.description,
        properties: WORKITEMDC8A1D_OUTPUT.properties,
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
