import { PLANECREATEWORKITEMRELATIONRESULTITEMITEM5C3495_OUTPUT } from '@/tools/plane/outputs'
import { planeCreateWorkItemRelationResultItemItem5c3495Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkItemRelationParams,
  PlaneCreateWorkItemRelationResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeListResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeCreateWorkItemRelationTool: ToolConfig<
  PlaneCreateWorkItemRelationParams,
  PlaneCreateWorkItemRelationResponse
> = {
  id: 'plane_create_work_item_relation',
  name: 'Plane v1 only: Create work item relation',
  description: 'v1 only: Create work item relation in Plane. Requires API v1.',
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
    relation_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type of relationship between work items - `blocking` - Blocking - `blocked_by` - Blocked By - `duplicate` - Duplicate - `relates_to` - Relates To - `start_before` - Start Before - `start_after` - Start After - `finish_before` - Finish Before - `finish_after` - Finish After',
    },
    issues: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of work item IDs to create relations with',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/relations/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          relation_type: { key: 'relation_type', type: 'string', required: true },
          issues: { key: 'issues', type: 'array', required: true },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeListResponse(response, planeCreateWorkItemRelationResultItemItem5c3495Schema, false, true),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PLANECREATEWORKITEMRELATIONRESULTITEMITEM5C3495_OUTPUT.type,
        description: PLANECREATEWORKITEMRELATIONRESULTITEMITEM5C3495_OUTPUT.description,
        properties: PLANECREATEWORKITEMRELATIONRESULTITEMITEM5C3495_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
