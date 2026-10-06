import {
  CYCLEWORKITEM52A223_OUTPUT,
  PLANEV2V2MANAGECYCLEWORKITEMSRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  cycleWorkItem52a223Schema,
  planeV2V2ManageCycleWorkItemsresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneManageCycleWorkItemsParams,
  PlaneManageCycleWorkItemsResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeMembershipChange,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeManageCycleWorkItemsTool: ToolConfig<
  PlaneManageCycleWorkItemsParams,
  PlaneManageCycleWorkItemsResponse
> = {
  id: 'plane_manage_cycle_work_items',
  name: 'Plane Add or remove cycle work items',
  description: 'Add or remove cycle work items in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The cycle work item id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['pk', 'project_id', 'workspace_slug', 'add', 'remove']
          : ['workspace_slug', 'project_id', 'pk', 'add', 'remove'],
        ['workspace_slug', 'project_id', 'pk', 'add', 'remove'],
        version
      )
      return version === 'v1'
        ? planeMembershipChange(params).action === 'remove'
          ? `${planeApiUrl(params.baseUrl, `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/cycle-issues/`)}${safeUrlPathSegment(planeMembershipChange(params).first, 'remove')}/`
          : planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/cycle-issues/`
            )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/work-items/`
          )
    },
    method: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1' &&
      planeMembershipChange(params).action === 'remove'
        ? 'DELETE'
        : 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeMembershipChange(params).action === 'remove'
          ? undefined
          : planeVersionedValues(
              params,
              {
                issues: { key: 'add', type: 'array', required: true },
                remove: { key: 'remove', type: 'array', required: false },
              },
              params.bodyOverrides
            )
        : planeVersionedValues(
            params,
            {
              add: { key: 'add', type: 'array', required: false },
              remove: { key: 'remove', type: 'array', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeMembershipChange(params ?? {}).action === 'remove'
        ? { success: true, output: { success: true } }
        : planeListResponse(response, cycleWorkItem52a223Schema, false, false)
      : planeObjectResponse(response, planeV2V2ManageCycleWorkItemsresultSchema),
  postProcess: async (result, params, executeTool) => {
    if (planeApiVersion(params.apiVersion, true) !== 'v1') return result
    const change = planeMembershipChange(params)
    if (change.action !== 'remove') return result
    let completed = 1
    try {
      for (const workItemId of change.ids.slice(1)) {
        const removed = await executeTool('plane_manage_cycle_work_items', {
          ...params,
          add: undefined,
          remove: [workItemId],
          bodyOverrides: undefined,
        })
        if (!removed.success) throw new Error('Plane membership removal failed')
        completed += 1
      }
      return result
    } catch {
      return {
        ...result,
        success: false,
        error: `Plane v1 removed ${completed} work items before a removal failed`,
      }
    }
  },
  outputs: {
    result: PLANEV2V2MANAGECYCLEWORKITEMSRESULT_OUTPUT,
    success: { type: 'boolean', optional: true, description: 'v1 removal completed successfully.' },
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: CYCLEWORKITEM52A223_OUTPUT.type,
        description: CYCLEWORKITEM52A223_OUTPUT.description,
        properties: CYCLEWORKITEM52A223_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
