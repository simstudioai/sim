import { PLANEV2V2GETPROJECTSUMMARYRESULT4F96BD_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2GetProjectSummaryresult4f96bdSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetProjectSummaryParams,
  PlaneGetProjectSummaryResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetProjectSummaryTool: ToolConfig<
  PlaneGetProjectSummaryParams,
  PlaneGetProjectSummaryResponse
> = {
  id: 'plane_get_project_summary',
  name: 'Plane Get a project summary',
  description: 'Get a project summary in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project summary id.',
    },
    counts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated count keys to include. Allowed: members, states, labels, cycles, modules, issues, intakes, work_item_types, work_item_properties, pages. Omitting returns all. Unknown keys are a 400.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Comma-separated list of fields.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1' ? ['workspace_slug', 'pk', 'fields'] : ['workspace_slug', 'pk', 'counts'],
        ['workspace_slug', 'pk', 'counts', 'fields'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.pk, 'pk')}/summary/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.pk, 'pk')}/summary/`,
            planeVersionedValues(params, {
              counts: { key: 'counts', type: 'string', required: false },
            })
          )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2V2GetProjectSummaryresult4f96bdSchema)
      : planeObjectResponse(response, planeV2V2GetProjectSummaryresult4f96bdSchema),
  outputs: { result: PLANEV2V2GETPROJECTSUMMARYRESULT4F96BD_OUTPUT },
}
