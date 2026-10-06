import type {
  PlaneDeleteWorkItemPropertyValueParams,
  PlaneDeleteWorkItemPropertyValueResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeleteWorkItemPropertyValueTool: ToolConfig<
  PlaneDeleteWorkItemPropertyValueParams,
  PlaneDeleteWorkItemPropertyValueResponse
> = {
  id: 'plane_delete_work_item_property_value',
  name: 'Plane v1 only: Delete property value',
  description: 'v1 only: Delete property value in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the project.',
    },
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the property.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    work_item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the work item.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/values/`
      )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
