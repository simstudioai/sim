import { MILESTONEWORKITEM_OUTPUT } from '@/tools/plane/outputs'
import { milestoneWorkItemSchema } from '@/tools/plane/schemas'
import type {
  PlaneListMilestoneWorkItemsParams,
  PlaneListMilestoneWorkItemsResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_PAGINATION_OUTPUT,
  planeApiUrl,
  planeHeaders,
  planeListResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeListMilestoneWorkItemsTool: ToolConfig<
  PlaneListMilestoneWorkItemsParams,
  PlaneListMilestoneWorkItemsResponse
> = {
  id: 'plane_list_milestone_work_items',
  name: 'Plane v1 only: List milestone work items',
  description: 'v1 only: List milestone work items in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    milestone_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the milestone.',
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
      description: 'Pagination cursor for the next or previous page.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1–100).',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/milestones/${safeUrlPathSegment(params.milestone_id, 'milestone_id')}/work-items/`,
        planeVersionedValues(params, {
          cursor: { key: 'cursor', type: 'string', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeListResponse(response, milestoneWorkItemSchema, true, false),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: MILESTONEWORKITEM_OUTPUT.type,
        description: MILESTONEWORKITEM_OUTPUT.description,
        properties: MILESTONEWORKITEM_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
    pagination: PLANE_PAGINATION_OUTPUT,
  },
}
