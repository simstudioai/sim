import { PLANEV2WORKITEMSA7B6DE_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemsa7b6deSchema } from '@/tools/plane/schemas'
import type { PlaneUpsertWorkItemParams, PlaneUpsertWorkItemResponse } from '@/tools/plane/types'
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

export const planeUpsertWorkItemTool: ToolConfig<
  PlaneUpsertWorkItemParams,
  PlaneUpsertWorkItemResponse
> = {
  id: 'plane_upsert_work_item',
  name: 'Plane Upsert a work item',
  description: 'Upsert a work item in Plane. Requires API v2.',
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
      description:
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    assignee_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the assignees to associate. Replaces the current set.',
    },
    assignees: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The assignees.',
    },
    cycle_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related cycle. Nullable.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Rich-text body as HTML. This is the field the Plane editor round-trips. Nullable.',
    },
    estimate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The estimate. Nullable.',
    },
    estimate_point_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related estimate point. Nullable.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this record, for sync and import correlation. Maximum 255 characters. Nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable.',
    },
    label_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the labels to associate. Replaces the current set.',
    },
    labels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The labels.',
    },
    module_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the modules to associate. Replaces the current set.',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The parent. Nullable.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related parent. Nullable.',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `none` - None - `low` - Low - `medium` - Medium - `high` - High - `urgent` - Urgent One of `none`, `low`, `medium`, `high`, `urgent`.',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start date, as `YYYY-MM-DD`. Nullable.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The state. Nullable.',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related state. Nullable.',
    },
    target_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned due date, as `YYYY-MM-DD`. Nullable.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The type. Nullable.',
    },
    type_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related type. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `assignee_ids`, `created_at`, `created_by_id`, `custom_fields`, `cycle_id`, `id`, `identifier`, `is_draft`, `label_ids`, `module_ids`, `name`, `parent_id`, `priority`, `project_id`, `sequence_id`, `start_date`, `state_id`, `target_date`, `type_id`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `assignees`, `cycle`, `labels`, `modules`, `parent`, `state`, `type`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/upsert/`,
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
      planeVersionedValues(
        params,
        {
          name: { key: 'name', type: 'string', required: true },
          assignee_ids: { key: 'assignee_ids', type: 'array', required: false },
          assignees: { key: 'assignees', type: 'array', required: false },
          cycle_id: { key: 'cycle_id', type: 'string', required: false },
          description_html: { key: 'description_html', type: 'string', required: false },
          estimate: { key: 'estimate', type: 'string', required: false },
          estimate_point_id: { key: 'estimate_point_id', type: 'string', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
          label_ids: { key: 'label_ids', type: 'array', required: false },
          labels: { key: 'labels', type: 'array', required: false },
          module_ids: { key: 'module_ids', type: 'array', required: false },
          parent: { key: 'parent', type: 'string', required: false },
          parent_id: { key: 'parent_id', type: 'string', required: false },
          priority: { key: 'priority', type: 'string', required: false },
          start_date: { key: 'start_date', type: 'string', required: false },
          state: { key: 'state', type: 'string', required: false },
          state_id: { key: 'state_id', type: 'string', required: false },
          target_date: { key: 'target_date', type: 'string', required: false },
          type: { key: 'type', type: 'string', required: false },
          type_id: { key: 'type_id', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkItemsa7b6deSchema),
  outputs: { result: PLANEV2WORKITEMSA7B6DE_OUTPUT },
}
