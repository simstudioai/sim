import { CYCLEWORKITEM639FF1_OUTPUT } from '@/tools/plane/outputs'
import { cycleWorkItem639ff1Schema } from '@/tools/plane/schemas'
import type {
  PlaneGetCycleWorkItemParams,
  PlaneGetCycleWorkItemResponse,
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

export const planeGetCycleWorkItemTool: ToolConfig<
  PlaneGetCycleWorkItemParams,
  PlaneGetCycleWorkItemResponse
> = {
  id: 'plane_get_cycle_work_item',
  name: 'Plane v1 only: Get cycle work item',
  description: 'v1 only: Get cycle work item in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
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
      description: 'Project id.',
    },
    cycle_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cycle id.',
    },
    work_item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work item id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of expand.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.cycle_id, 'cycle_id')}/cycle-issues/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/`,
        planeVersionedValues(params, {
          fields: { key: 'fields', type: 'string', required: false },
          expand: { key: 'expand', type: 'string', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, cycleWorkItem639ff1Schema),
  outputs: { result: CYCLEWORKITEM639FF1_OUTPUT },
}
