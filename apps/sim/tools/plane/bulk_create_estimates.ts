import { PLANEV2V2BULKCREATEESTIMATESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2BulkCreateEstimatesresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneBulkCreateEstimatesParams,
  PlaneBulkCreateEstimatesResponse,
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

export const planeBulkCreateEstimatesTool: ToolConfig<
  PlaneBulkCreateEstimatesParams,
  PlaneBulkCreateEstimatesResponse
> = {
  id: 'plane_bulk_create_estimates',
  name: 'Plane Bulk create estimates',
  description: 'Bulk create estimates in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
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
        'The project the estimates belong to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The estimates to create — each entry takes the same body as [Create an estimate](/api-reference/v2/estimates/create-estimate). Between 1 and **50** per call.',
    },
    all_or_none: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defaults to `false`. Leave it off for partial success: each row runs in its own savepoint, successful rows commit, and you read the breakdown. Set it to `true` to make the batch atomic. Every row is still evaluated, but if **any** row fails the whole batch is discarded and the call answers `409` instead of the `200` envelope. Side effects scheduled by the rows follow the same outcome.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/estimates/bulk-create/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          items: { key: 'items', type: 'array', required: true },
          all_or_none: { key: 'all_or_none', type: 'boolean', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2BulkCreateEstimatesresultSchema),
  outputs: { result: PLANEV2V2BULKCREATEESTIMATESRESULT_OUTPUT },
}
