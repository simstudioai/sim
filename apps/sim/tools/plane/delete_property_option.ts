import type {
  PlaneDeletePropertyOptionParams,
  PlaneDeletePropertyOptionResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeletePropertyOptionTool: ToolConfig<
  PlaneDeletePropertyOptionParams,
  PlaneDeletePropertyOptionResponse
> = {
  id: 'plane_delete_property_option',
  name: 'Plane Delete a property option',
  description: 'Delete a property option in Plane. Supports API v1 compatibility.',
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
      description: 'The project that owns the property.',
    },
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The `OPTION` property the option belongs to. See [Work item properties](/api-reference/v2/work-item-properties/overview).',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The id of the option to delete. Every ancestor in the path is enforced — an option id that belongs to a different property returns `404` rather than deleting anything.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['pk', 'project_id', 'property_id', 'workspace_slug']
          : ['workspace_slug', 'project_id', 'property_id', 'pk'],
        ['workspace_slug', 'project_id', 'property_id', 'pk'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (_response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? { success: true, output: { success: true } }
      : { success: true, output: { success: true } },
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
