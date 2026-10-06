import { isRecordLike, toRecord } from '@sim/utils/object'
import { PLANEV2WORKITEMS70DCEE_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItems70dceeSchema } from '@/tools/plane/schemas'
import type { PlaneUpdateWorkItemParams, PlaneUpdateWorkItemResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeBodyValue,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

function requestedRelationClears(params: PlaneUpdateWorkItemParams): Record<string, unknown> {
  const overrides = params.bodyOverrides
    ? toRecord(planeBodyValue(params.bodyOverrides, 'object', 'bodyOverrides'))
    : {}
  const clears: Record<string, unknown> = {}
  for (const [canonical, aliases] of [
    ['label_ids', ['label_ids', 'labels']],
    ['assignee_ids', ['assignee_ids', 'assignees']],
  ] as const) {
    for (const alias of aliases) {
      const value = Object.hasOwn(overrides, alias) ? overrides[alias] : params[alias]
      if (value === undefined) continue
      const parsed = planeBodyValue(value, 'array', alias)
      if (Array.isArray(parsed) && parsed.length === 0) clears[canonical] = []
    }
  }
  const parent = Object.hasOwn(overrides, 'parent_id') ? overrides.parent_id : params.parent_id
  if (parent === null) clears.parent_id = null
  return clears
}

function relationWasCleared(record: Record<string, unknown>, name: string): boolean {
  const value = record[name]
  return name === 'parent_id' ? value === null : Array.isArray(value) && value.length === 0
}

export const planeUpdateWorkItemTool: ToolConfig<
  PlaneUpdateWorkItemParams,
  PlaneUpdateWorkItemResponse
> = {
  id: 'plane_update_work_item',
  name: 'Plane Update a work item',
  description: 'Update a work item in Plane. Supports API v1 compatibility.',
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
      description: 'The project the work item belongs to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The work item's UUID. This lookup is UUID-only — a `PROJ-142` identifier here returns `404`.",
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title. Maximum 255 characters.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Replacement rich-text body as HTML. Sanitized on the way in; content that can't be sanitized is rejected with a `400`. Not part of the read shape, so it won't appear in the response.",
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'One of `urgent`, `high`, `medium`, `low`, `none`.',
    },
    state_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Move the work item to another state of the same project. This is the field workflow rules police — see [Workflow rules](#workflow-rules-can-reject-a-transition).',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The target state's **name** instead of its id, for example `Done`. Matched case-insensitively within the project. Write-only. Sending both `state` and `state_id` is a `400`.",
    },
    type_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Change the work item type. Send `null` to make the work item untyped.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The type's **name** instead of its id, for example `Bug`. Write-only.",
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Re-parent the work item. The parent must be in the same workspace and may be in a different project. Send `null` to detach it and make it top-level.',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The parent's **identifier** instead of its id, for example `PROJ-118`. Write-only.",
    },
    assignee_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        '**Replaces** the whole assignee set — it is not additive. Send the complete list you want, `[]` to unassign everyone, or omit the field to leave assignees untouched.',
    },
    assignees: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Member **email addresses** instead of ids. Same replace-the-set semantics. Every address must belong to an active, assignable project member. Write-only.',
    },
    label_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        '**Replaces** the whole label set. Send `[]` to strip all labels, or omit the field to leave them untouched.',
    },
    labels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Label **names** instead of ids. Same replace-the-set semantics. A name that exists at both project and workspace level is ambiguous and returns a `400` telling you to use `label_ids`. Write-only.',
    },
    estimate_point_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Change the estimate point, from the project's active estimate system. Send `null` to clear the estimate.",
    },
    estimate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The estimate point's **value** instead of its id, for example `5`. Write-only.",
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start, or `null` to clear it. Must not be after `target_date`.',
    },
    target_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned due date, or `null` to clear it.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this work item. Maximum 255 characters. Filterable on [List work items](https://developers.plane.so/api-reference/v2/work-items/list-work-items), but not returned on reads.",
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
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `assignee_ids`, `created_at`, `created_by_id`, `custom_fields`, `cycle_id`, `id`, `identifier`, `is_draft`, `label_ids`, `module_ids`, `name`, `parent_id`, `priority`, `project_id`, `sequence_id`, `start_date`, `state_id`, `target_date`, `type_id`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated relations to embed alongside the ids: `assignees` (the assigned users), `cycle` (the cycle it belongs to), `labels` (the applied labels), `modules` (the modules it belongs to), `parent` (its parent work item), `state` (the work item's state object), `type` (its work item type). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.",
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
    custom_fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON custom field values. API v2 only.',
    },
    cycle_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cycle ID. API v2 only.',
    },
    module_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Module IDs. API v2 only.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'pk',
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
            ]
          : [
              'workspace_slug',
              'project_id',
              'pk',
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
              'custom_fields',
              'cycle_id',
              'module_ids',
            ],
        [
          'workspace_slug',
          'project_id',
          'pk',
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
          'custom_fields',
          'cycle_id',
          'module_ids',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
            })
          )
    },
    method: 'PATCH',
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
              name: { key: 'name', type: 'string', required: false },
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
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: false },
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
              custom_fields: { key: 'custom_fields', type: 'object', required: false },
              cycle_id: { key: 'cycle_id', type: 'string', required: false },
              module_ids: { key: 'module_ids', type: 'array', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkItems70dceeSchema)
      : planeObjectResponse(response, planeV2WorkItems70dceeSchema),
  postProcess: async (result, params, executeTool) => {
    if (planeApiVersion(params.apiVersion, true) !== 'v2') return result
    const clears = requestedRelationClears(params)
    if (!Object.keys(clears).length) return result
    const scope = {
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      workspace_slug: params.workspace_slug,
      project_id: params.project_id,
      pk: params.pk,
    }
    try {
      const verification = await executeTool('plane_get_work_item', {
        ...scope,
        apiVersion: 'v2',
        fields: 'id,label_ids,assignee_ids,parent_id',
      })
      if (!verification.success) throw new Error('Plane relation clearing could not be verified')
      const current = toRecord(verification.output.result)
      const unapplied: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(clears)) {
        if (!relationWasCleared(current, name)) unapplied[name] = value
      }
      if (!Object.keys(unapplied).length) return result
      const compatibility = await executeTool('plane_update_work_item', {
        ...scope,
        apiVersion: 'v1',
        bodyOverrides: unapplied,
      })
      if (!compatibility.success)
        throw new Error(
          'Plane v2 did not apply a relation clear and the v1 compatibility update failed'
        )
      const legacy = toRecord(compatibility.output.result)
      const legacyNames: Record<string, string> = {
        label_ids: 'labels',
        assignee_ids: 'assignees',
        parent_id: 'parent',
      }
      for (const name of Object.keys(unapplied)) {
        const legacyName = legacyNames[name]
        if (!legacyName || !relationWasCleared({ [name]: legacy[legacyName] }, name))
          throw new Error('Plane did not apply the requested relation clear')
      }
      const refreshed = await executeTool('plane_get_work_item', {
        ...scope,
        apiVersion: 'v2',
        fields: params.fields,
        expand: params.expand,
      })
      if (!refreshed.success || !isRecordLike(refreshed.output.result))
        throw new Error('Plane updated the relations but the final read failed')
      const verified = { ...refreshed.output.result, ...unapplied }
      for (const [canonical, expanded] of [
        ['label_ids', 'labels'],
        ['assignee_ids', 'assignees'],
      ] as const) {
        if (Object.hasOwn(unapplied, canonical) && Object.hasOwn(verified, expanded))
          verified[expanded] = []
      }
      return { ...result, output: { result: planeV2WorkItems70dceeSchema.parse(verified) } }
    } catch {
      return {
        ...result,
        success: false,
        error:
          'Plane could not complete or verify the requested relation clear. The initial update may already have been applied.',
      }
    }
  },
  outputs: { result: PLANEV2WORKITEMS70DCEE_OUTPUT },
}
