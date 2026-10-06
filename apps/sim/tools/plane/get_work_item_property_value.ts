import { WORKITEMPROPERTYVALUEDETAIL_OUTPUT } from '@/tools/plane/outputs'
import { workItemPropertyValueDetailSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkItemPropertyValueParams,
  PlaneGetWorkItemPropertyValueResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetWorkItemPropertyValueTool: ToolConfig<
  PlaneGetWorkItemPropertyValueParams,
  PlaneGetWorkItemPropertyValueResponse
> = {
  id: 'plane_get_work_item_property_value',
  name: 'Plane v1 only: Get property value',
  description: 'v1 only: Get property value in Plane. Requires API v1.',
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
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, workItemPropertyValueDetailSchema),
  outputs: { result: WORKITEMPROPERTYVALUEDETAIL_OUTPUT },
}
