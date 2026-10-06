import { PLANEV2WORKSPACEWORKITEMPROPERTYOPTIONS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceWorkItemPropertyOptionsSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkspacePropertyOptionParams,
  PlaneGetWorkspacePropertyOptionResponse,
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

export const planeGetWorkspacePropertyOptionTool: ToolConfig<
  PlaneGetWorkspacePropertyOptionParams,
  PlaneGetWorkspacePropertyOptionResponse
> = {
  id: 'plane_get_workspace_property_option',
  name: 'Plane Get a workspace property option',
  description: 'Get a workspace property option in Plane. Requires API v2.',
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
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The workspace-level property the option belongs to. See [Workspace work item properties](/api-reference/v2/workspace-work-item-properties/overview).',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The option to retrieve.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/${safeUrlPathSegment(params.pk, 'pk')}/`
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceWorkItemPropertyOptionsSchema),
  outputs: { result: PLANEV2WORKSPACEWORKITEMPROPERTYOPTIONS_OUTPUT },
}
