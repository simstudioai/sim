import { PLANEV2V2ATTACHWORKSPACETYPEPROPERTYRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2AttachWorkspaceTypePropertyresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneAttachWorkspaceTypePropertyParams,
  PlaneAttachWorkspaceTypePropertyResponse,
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

export const planeAttachWorkspaceTypePropertyTool: ToolConfig<
  PlaneAttachWorkspaceTypePropertyParams,
  PlaneAttachWorkspaceTypePropertyResponse
> = {
  id: 'plane_attach_workspace_type_property',
  name: 'Plane Attach properties to a workspace type',
  description: 'Attach properties to a workspace type in Plane. Requires API v2.',
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
    type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The workspace work item type to attach the properties to.',
    },
    properties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Ids of properties to attach, taken from the workspace property catalog. Send the whole set you want in one call rather than one request per property. Every id must already exist in this workspace. An unknown id — including one that belongs to another workspace — fails the request with `400 invalid_request`; nothing is attached, and a cross-tenant id is never silently linked.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-types/${safeUrlPathSegment(params.type_id, 'type_id')}/properties/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { properties: { key: 'properties', type: 'array', required: true } },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2AttachWorkspaceTypePropertyresultSchema),
  outputs: { result: PLANEV2V2ATTACHWORKSPACETYPEPROPERTYRESULT_OUTPUT },
}
