import type {
  PlaneDeleteWorkspacePropertyOptionParams,
  PlaneDeleteWorkspacePropertyOptionResponse,
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

export const planeDeleteWorkspacePropertyOptionTool: ToolConfig<
  PlaneDeleteWorkspacePropertyOptionParams,
  PlaneDeleteWorkspacePropertyOptionResponse
> = {
  id: 'plane_delete_workspace_property_option',
  name: 'Plane Delete a workspace property option',
  description: 'Delete a workspace property option in Plane. Requires API v2.',
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
      description:
        'The option to delete. It is looked up within the property, so an option id under the wrong `property_id` is a `404`.',
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
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
