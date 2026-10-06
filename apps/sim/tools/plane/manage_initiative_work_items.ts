import { PLANEV2V2MANAGEINITIATIVEWORKITEMSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ManageInitiativeWorkItemsresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneManageInitiativeWorkItemsParams,
  PlaneManageInitiativeWorkItemsResponse,
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

export const planeManageInitiativeWorkItemsTool: ToolConfig<
  PlaneManageInitiativeWorkItemsParams,
  PlaneManageInitiativeWorkItemsResponse
> = {
  id: 'plane_manage_initiative_work_items',
  name: 'Plane Add or remove initiative work items',
  description: 'Add or remove initiative work items in Plane. Requires API v2.',
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
      description: 'The initiative work item id.',
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
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/${safeUrlPathSegment(params.pk, 'pk')}/work-items/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          add: { key: 'add', type: 'array', required: false },
          remove: { key: 'remove', type: 'array', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2ManageInitiativeWorkItemsresultSchema),
  outputs: { result: PLANEV2V2MANAGEINITIATIVEWORKITEMSRESULT_OUTPUT },
}
