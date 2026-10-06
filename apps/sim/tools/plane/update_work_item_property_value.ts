import { WORKITEMPROPERTYVALUEDETAIL_OUTPUT } from '@/tools/plane/outputs'
import { workItemPropertyValueDetailSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkItemPropertyValueParams,
  PlaneUpdateWorkItemPropertyValueResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeUpdateWorkItemPropertyValueTool: ToolConfig<
  PlaneUpdateWorkItemPropertyValueParams,
  PlaneUpdateWorkItemPropertyValueResponse
> = {
  id: 'plane_update_work_item_property_value',
  name: 'Plane v1 only: Update property value',
  description: 'v1 only: Update property value in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
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
    value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The value to set for the property. Type depends on property type: string for text/url/email/file fields, string (UUID) or list of UUIDs for relations/options (list only when is_multi=True), string (YYYY-MM-DD) for dates, number for decimals, boolean for booleans',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional external identifier for syncing with external systems',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Optional external source identifier (e.g., 'github', 'jira')",
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/values/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          value: { key: 'value', type: 'object', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, workItemPropertyValueDetailSchema),
  outputs: { result: WORKITEMPROPERTYVALUEDETAIL_OUTPUT },
}
