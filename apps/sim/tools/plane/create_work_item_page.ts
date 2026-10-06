import { WORKITEMPAGECAC7C5_OUTPUT } from '@/tools/plane/outputs'
import { workItemPagecac7c5Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkItemPageParams,
  PlaneCreateWorkItemPageResponse,
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

export const planeCreateWorkItemPageTool: ToolConfig<
  PlaneCreateWorkItemPageParams,
  PlaneCreateWorkItemPageResponse
> = {
  id: 'plane_create_work_item_page',
  name: 'Plane v1 only: Create work item page link',
  description: 'v1 only: Create work item page link in Plane. Requires API v1.',
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
    page_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the page to link to the work item',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/pages/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { page_id: { key: 'page_id', type: 'string', required: true } },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, workItemPagecac7c5Schema),
  outputs: { result: WORKITEMPAGECAC7C5_OUTPUT },
}
