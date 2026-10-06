import { PLANEV2ESTIMATEPOINTS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2EstimatePointsSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetEstimatePointParams,
  PlaneGetEstimatePointResponse,
} from '@/tools/plane/types'
import {
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

export const planeGetEstimatePointTool: ToolConfig<
  PlaneGetEstimatePointParams,
  PlaneGetEstimatePointResponse
> = {
  id: 'plane_get_estimate_point',
  name: 'Plane Get an estimate point',
  description: 'Get an estimate point in Plane. Requires API v2.',
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
    estimate_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The estimate the points belong to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The estimate point id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description`, `estimate_id`, `external_id`, `external_source`, `id`, `key`, `value`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/estimates/${safeUrlPathSegment(params.estimate_id, 'estimate_id')}/points/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2EstimatePointsSchema),
  outputs: { result: PLANEV2ESTIMATEPOINTS_OUTPUT },
}
