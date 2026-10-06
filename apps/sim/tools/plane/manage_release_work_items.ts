import { PLANEV2V2MANAGERELEASEWORKITEMSRESULT0E13C5_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ManageReleaseWorkItemsresult0e13c5Schema } from '@/tools/plane/schemas'
import type {
  PlaneManageReleaseWorkItemsParams,
  PlaneManageReleaseWorkItemsResponse,
} from '@/tools/plane/types'
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

export const planeManageReleaseWorkItemsTool: ToolConfig<
  PlaneManageReleaseWorkItemsParams,
  PlaneManageReleaseWorkItemsResponse
> = {
  id: 'plane_manage_release_work_items',
  name: 'Plane Add or remove release work items',
  description: 'Add or remove release work items in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The release work item id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
    work_item_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Array of work item IDs to add to the release.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'work_item_ids']
          : ['workspace_slug', 'pk', 'add', 'remove'],
        ['workspace_slug', 'pk', 'add', 'remove', 'work_item_ids'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/work-items/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/work-items/`
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            { work_item_ids: { key: 'work_item_ids', type: 'array', required: true } },
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
      ? planeObjectResponse(response, planeV2V2ManageReleaseWorkItemsresult0e13c5Schema)
      : planeObjectResponse(response, planeV2V2ManageReleaseWorkItemsresult0e13c5Schema),
  outputs: { result: PLANEV2V2MANAGERELEASEWORKITEMSRESULT0E13C5_OUTPUT },
}
