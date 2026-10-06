import { PLANEV2V2GETPROJECTWORKLOGSUMMARYRESULTITEM9FE59D_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2GetProjectWorklogSummaryresultitem9fe59dSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetProjectWorklogSummaryParams,
  PlaneGetProjectWorklogSummaryResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetProjectWorklogSummaryTool: ToolConfig<
  PlaneGetProjectWorklogSummaryParams,
  PlaneGetProjectWorklogSummaryResponse
> = {
  id: 'plane_get_project_worklog_summary',
  name: 'Plane Get the project worklog summary',
  description: 'Get the project worklog summary in Plane. Supports API v1 compatibility.',
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
      description:
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1' ? ['project_id', 'workspace_slug'] : ['workspace_slug', 'project_id'],
        ['workspace_slug', 'project_id'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/total-worklogs/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/worklogs/summary/`
          )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeListResponse(
          response,
          planeV2V2GetProjectWorklogSummaryresultitem9fe59dSchema,
          false,
          false
        )
      : planeListResponse(
          response,
          planeV2V2GetProjectWorklogSummaryresultitem9fe59dSchema,
          false,
          false
        ),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PLANEV2V2GETPROJECTWORKLOGSUMMARYRESULTITEM9FE59D_OUTPUT.type,
        description: PLANEV2V2GETPROJECTWORKLOGSUMMARYRESULTITEM9FE59D_OUTPUT.description,
        properties: PLANEV2V2GETPROJECTWORKLOGSUMMARYRESULTITEM9FE59D_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
