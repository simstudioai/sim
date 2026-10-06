import { PLANEV2WORKITEMS90FFDA_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItems90ffdaSchema } from '@/tools/plane/schemas'
import type { PlaneCreateWorkItemParams, PlaneCreateWorkItemResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
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

export const planeCreateWorkItemTool: ToolConfig<
  PlaneCreateWorkItemParams,
  PlaneCreateWorkItemResponse
> = {
  id: 'plane_create_work_item',
  name: 'Plane Create a work item',
  description: 'Create a work item in Plane. Supports API v1 compatibility.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
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
      description: 'The project to create the work item in.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the work item. Maximum 255 characters. The only required field.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Rich-text body as HTML, for example `Steps to reproduce…`. The HTML is sanitized on the way in; content that can't be sanitized is rejected with a `400`. `description_html` is **not** part of the read shape, so it will not appear in the response.",
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'One of `urgent`, `high`, `medium`, `low`, `none`. Defaults to `none`.',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The workflow state to create the work item in. Must be a state of this project. Omit it and the work item lands in the project's default state.",
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The state's **name** instead of its id, for example `In Progress`. Matched case-insensitively within the project. Write-only. Unknown name or a name that matches more than one state is a `400`. Sending both `state` and `state_id` is a `400`.",
    },
    type_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The work item type. Accepts a type owned by the project and a workspace-level type imported into it. Requires work item types to be enabled.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The type's **name** instead of its id, for example `Bug`. Matched case-insensitively among the project's non-epic types. Write-only.",
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The parent work item. The parent must be in the same workspace, but it may live in a different project.',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The parent's **identifier** instead of its id, for example `PROJ-118`. Resolved within the workspace. Write-only.",
    },
    assignee_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "User ids to assign. Each must be an active, assignable member of the project. Leave it out and the project's default assignee is applied, if one is configured. Send `[]` to create the work item with no assignee at all.",
    },
    assignees: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Member **email addresses** instead of ids, for example `["ana@example.com"]`. Every address must belong to an active, assignable project member — any that don\'t are named in the `400`. Write-only.',
    },
    label_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Label ids to apply. Each must be a label of this project, or a workspace-level label available to it.',
    },
    labels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Label **names** instead of ids, for example `["regression", "auth"]`. Matched case-insensitively against the project\'s labels and the workspace-level labels available to it. A name that exists at both levels is ambiguous and returns a `400` telling you to use `label_ids`. Write-only.',
    },
    estimate_point_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The estimate point to assign, from the project's active estimate system.",
    },
    estimate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The estimate point's **value** instead of its id, for example `5` or `L`. Resolved against the project's active estimate. Write-only.",
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start, for example `2026-01-12`. Must not be after `target_date`.',
    },
    target_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned due date, for example `2026-01-20`.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this work item, for sync and import correlation. Maximum 255 characters. Stored and filterable on [List work items](/api-reference/v2/work-items/list-work-items), but not returned on reads.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `assignee_ids`, `created_at`, `created_by_id`, `custom_fields`, `cycle_id`, `id`, `identifier`, `is_draft`, `label_ids`, `module_ids`, `name`, `parent_id`, `priority`, `project_id`, `sequence_id`, `start_date`, `state_id`, `target_date`, `type_id`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated relations to embed alongside the ids: `assignees` (the assigned users), `cycle` (the cycle it belongs to), `labels` (the applied labels), `modules` (the modules it belongs to), `parent` (its parent work item), `state` (the work item's state object), `type` (its work item type). Expansion is separate-key: `?expand=state` keeps `state_id` and adds a `state` object next to it, so an id is never replaced by an object. An unknown value is a `400`. `?fields=` and `?expand=` are independent namespaces. Relation names are not valid `?fields=` tokens (and vice versa), and an expanded object survives field filtering — `?fields=id,name&expand=state` returns `id`, `name` and `state`. See [Expanding relations](/api-reference/v2/expanding-relations).",
    },
    deleted_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Deleted at.',
    },
    point: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Point.',
    },
    sequence_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Sequence id.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Sort order.',
    },
    archived_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Archived at.',
    },
    is_draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Is draft.',
    },
    created_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Created by.',
    },
    created_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Creation timestamp for imports.',
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
              'assignee_ids',
              'label_ids',
              'type_id',
              'parent_id',
              'deleted_at',
              'point',
              'name',
              'description_html',
              'priority',
              'start_date',
              'target_date',
              'sequence_id',
              'sort_order',
              'archived_at',
              'is_draft',
              'external_source',
              'external_id',
              'created_by',
              'state_id',
              'estimate_point_id',
              'type',
              'created_at',
            ]
          : [
              'workspace_slug',
              'project_id',
              'name',
              'description_html',
              'priority',
              'state_id',
              'state',
              'type_id',
              'type',
              'parent_id',
              'parent',
              'assignee_ids',
              'assignees',
              'label_ids',
              'labels',
              'estimate_point_id',
              'estimate',
              'start_date',
              'target_date',
              'external_id',
              'external_source',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'project_id',
          'name',
          'description_html',
          'priority',
          'state_id',
          'state',
          'type_id',
          'type',
          'parent_id',
          'parent',
          'assignee_ids',
          'assignees',
          'label_ids',
          'labels',
          'estimate_point_id',
          'estimate',
          'start_date',
          'target_date',
          'external_id',
          'external_source',
          'fields',
          'expand',
          'deleted_at',
          'point',
          'sequence_id',
          'sort_order',
          'archived_at',
          'is_draft',
          'created_by',
          'created_at',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              assignees: { key: 'assignee_ids', type: 'array', required: false },
              labels: { key: 'label_ids', type: 'array', required: false },
              type_id: { key: 'type_id', type: 'string', required: false },
              parent: { key: 'parent_id', type: 'string', required: false },
              deleted_at: { key: 'deleted_at', type: 'string', required: false },
              point: { key: 'point', type: 'integer', required: false },
              name: { key: 'name', type: 'string', required: true },
              description_html: {
                key: 'description_html',
                type: 'string',
                required: false,
                emptyHtml: true,
              },
              priority: { key: 'priority', type: 'string', required: false },
              start_date: { key: 'start_date', type: 'string', required: false },
              target_date: { key: 'target_date', type: 'string', required: false },
              sequence_id: { key: 'sequence_id', type: 'integer', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
              archived_at: { key: 'archived_at', type: 'string', required: false },
              is_draft: { key: 'is_draft', type: 'boolean', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              created_by: { key: 'created_by', type: 'string', required: false },
              state: { key: 'state_id', type: 'string', required: false },
              estimate_point: { key: 'estimate_point_id', type: 'string', required: false },
              type: { key: 'type', type: 'string', required: false },
              created_at: { key: 'created_at', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              description_html: { key: 'description_html', type: 'string', required: false },
              priority: { key: 'priority', type: 'string', required: false },
              state_id: { key: 'state_id', type: 'string', required: false },
              state: { key: 'state', type: 'string', required: false },
              type_id: { key: 'type_id', type: 'string', required: false },
              type: { key: 'type', type: 'string', required: false },
              parent_id: { key: 'parent_id', type: 'string', required: false },
              parent: { key: 'parent', type: 'string', required: false },
              assignee_ids: { key: 'assignee_ids', type: 'array', required: false },
              assignees: { key: 'assignees', type: 'array', required: false },
              label_ids: { key: 'label_ids', type: 'array', required: false },
              labels: { key: 'labels', type: 'array', required: false },
              estimate_point_id: { key: 'estimate_point_id', type: 'string', required: false },
              estimate: { key: 'estimate', type: 'string', required: false },
              start_date: { key: 'start_date', type: 'string', required: false },
              target_date: { key: 'target_date', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkItems90ffdaSchema)
      : planeObjectResponse(response, planeV2WorkItems90ffdaSchema),
  outputs: { result: PLANEV2WORKITEMS90FFDA_OUTPUT },
}
