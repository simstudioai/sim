import { PLANEV2V2GETWORKSPACEPERMISSIONSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2GetWorkspacePermissionsresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkspacePermissionsParams,
  PlaneGetWorkspacePermissionsResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetWorkspacePermissionsTool: ToolConfig<
  PlaneGetWorkspacePermissionsParams,
  PlaneGetWorkspacePermissionsResponse
> = {
  id: 'plane_get_workspace_permissions',
  name: 'Plane Get your effective workspace permissions',
  description: 'Get your effective workspace permissions in Plane. Requires API v2.',
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
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/permissions/me/`
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2GetWorkspacePermissionsresultSchema),
  outputs: { result: PLANEV2V2GETWORKSPACEPERMISSIONSRESULT_OUTPUT },
}
