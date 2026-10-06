import { PLANEWORKITEMCONTENT_OUTPUT } from '@/tools/plane/outputs'
import { planeWorkItemContentSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkItemSequenceIdParams,
  PlaneGetWorkItemSequenceIdResponse,
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

export const planeGetWorkItemSequenceIdTool: ToolConfig<
  PlaneGetWorkItemSequenceIdParams,
  PlaneGetWorkItemSequenceIdResponse
> = {
  id: 'plane_get_work_item_sequence_id',
  name: 'Plane v1 only: Retrieve a work item by identifier',
  description: 'v1 only: Retrieve a work item by identifier in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    issue_identifier: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The numeric issue identifier.',
    },
    project_identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project identifier key.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
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
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system identifier for filtering or lookup',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system source name for filtering or lookup',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Field to order results by. Prefix with '-' for descending order",
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-items/${safeUrlPathSegment(params.project_identifier, 'project_identifier')}-${safeUrlPathSegment(params.issue_identifier, 'issue_identifier')}/`,
        planeVersionedValues(params, {
          expand: { key: 'expand', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, planeWorkItemContentSchema),
  outputs: { result: PLANEWORKITEMCONTENT_OUTPUT },
}
