import { WORKITEMRELATIONS_OUTPUT } from '@/tools/plane/outputs'
import { workItemRelationsSchema } from '@/tools/plane/schemas'
import type {
  PlaneListWorkItemRelationsParams,
  PlaneListWorkItemRelationsResponse,
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

export const planeListWorkItemRelationsTool: ToolConfig<
  PlaneListWorkItemRelationsParams,
  PlaneListWorkItemRelationsResponse
> = {
  id: 'plane_list_work_item_relations',
  name: 'Plane v1 only: List work item relations',
  description: 'v1 only: List work item relations in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    work_item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the work item.',
    },
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the project.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for getting next set of results',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of related fields to expand in response',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields to include in response',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Field to order results by. Prefix with '-' for descending order",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default: 20, max: 100)',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/relations/`,
        planeVersionedValues(params, {
          cursor: { key: 'cursor', type: 'string', required: false },
          expand: { key: 'expand', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, workItemRelationsSchema),
  outputs: { result: WORKITEMRELATIONS_OUTPUT },
}
