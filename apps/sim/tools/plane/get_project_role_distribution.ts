import { PLANEV2V2GETPROJECTROLEDISTRIBUTIONRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2GetProjectRoleDistributionresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetProjectRoleDistributionParams,
  PlaneGetProjectRoleDistributionResponse,
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

export const planeGetProjectRoleDistributionTool: ToolConfig<
  PlaneGetProjectRoleDistributionParams,
  PlaneGetProjectRoleDistributionResponse
> = {
  id: 'plane_get_project_role_distribution',
  name: 'Plane Get project role distribution',
  description: 'Get project role distribution in Plane. Requires API v2.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/project-role-distribution/`
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2GetProjectRoleDistributionresultSchema),
  outputs: { result: PLANEV2V2GETPROJECTROLEDISTRIBUTIONRESULT_OUTPUT },
}
