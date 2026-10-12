import {
  MODULEWORKITEMA652D3_OUTPUT,
  PLANEV2V2MANAGEMODULEWORKITEMSRESULT_OUTPUT,
} from '@/tools/plane/outputs'
import {
  moduleWorkItema652d3Schema,
  planeV2V2ManageModuleWorkItemsresultSchema,
} from '@/tools/plane/schemas'
import type {
  PlaneManageModuleWorkItemsParams,
  PlaneManageModuleWorkItemsResponse,
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

export const planeManageModuleWorkItemsTool: ToolConfig<
  PlaneManageModuleWorkItemsParams,
  PlaneManageModuleWorkItemsResponse
> = {
  id: 'plane_manage_module_work_items',
  name: 'Plane Add or remove module work items',
  description: 'Add or remove module work items in Plane. Supports API v1 compatibility.',
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
      description: 'The module work item id.',
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
          ? `${planeApiUrl(params.baseUrl, `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/${safeUrlPathSegment(params.pk, 'pk')}/module-issues/`)}${safeUrlPathSegment(planeMembershipChange(params).first, 'remove')}/`
          : planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/${safeUrlPathSegment(params.pk, 'pk')}/module-issues/`
            )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/${safeUrlPathSegment(params.pk, 'pk')}/work-items/`
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
        : planeListResponse(response, moduleWorkItema652d3Schema, false, false)
      : planeObjectResponse(response, planeV2V2ManageModuleWorkItemsresultSchema),
  postProcess: async (result, params, executeTool) => {
    if (planeApiVersion(params.apiVersion, true) !== 'v1') return result
    const change = planeMembershipChange(params)
    if (change.action !== 'remove') return result
    let completed = 1
    try {
      for (const workItemId of change.ids.slice(1)) {
        const removed = await executeTool('plane_manage_module_work_items', {
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
    result: PLANEV2V2MANAGEMODULEWORKITEMSRESULT_OUTPUT,
    success: { type: 'boolean', optional: true, description: 'v1 removal completed successfully.' },
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: MODULEWORKITEMA652D3_OUTPUT.type,
        description: MODULEWORKITEMA652D3_OUTPUT.description,
        properties: MODULEWORKITEMA652D3_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
