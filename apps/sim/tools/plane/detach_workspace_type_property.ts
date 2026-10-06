import type {
  PlaneDetachWorkspaceTypePropertyParams,
  PlaneDetachWorkspaceTypePropertyResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDetachWorkspaceTypePropertyTool: ToolConfig<
  PlaneDetachWorkspaceTypePropertyParams,
  PlaneDetachWorkspaceTypePropertyResponse
> = {
  id: 'plane_detach_workspace_type_property',
  name: 'Plane Detach a property from a workspace type',
  description: 'Detach a property from a workspace type in Plane. Requires API v2.',
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
    type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The workspace work item type to detach the property from.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The property's id. A property that is not attached to this type returns `404`.",
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-types/${safeUrlPathSegment(params.type_id, 'type_id')}/properties/${safeUrlPathSegment(params.pk, 'pk')}/`
      )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
