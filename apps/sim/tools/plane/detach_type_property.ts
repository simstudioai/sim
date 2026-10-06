import type {
  PlaneDetachTypePropertyParams,
  PlaneDetachTypePropertyResponse,
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

export const planeDetachTypePropertyTool: ToolConfig<
  PlaneDetachTypePropertyParams,
  PlaneDetachTypePropertyResponse
> = {
  id: 'plane_detach_type_property',
  name: 'Plane Detach a property from a type',
  description: 'Detach a property from a type in Plane. Requires API v2.',
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
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project the work item type belongs to.',
    },
    type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The work item type to detach the property from.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The id of the property to detach — the property's own id, not a separate link id. It is the same value you passed in the `properties` array when you attached it.",
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-types/${safeUrlPathSegment(params.type_id, 'type_id')}/properties/${safeUrlPathSegment(params.pk, 'pk')}/`
      )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
