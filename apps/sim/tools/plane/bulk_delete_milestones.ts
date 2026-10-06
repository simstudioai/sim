import { PLANEV2V2BULKDELETEMILESTONESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2BulkDeleteMilestonesresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneBulkDeleteMilestonesParams,
  PlaneBulkDeleteMilestonesResponse,
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

export const planeBulkDeleteMilestonesTool: ToolConfig<
  PlaneBulkDeleteMilestonesParams,
  PlaneBulkDeleteMilestonesResponse
> = {
  id: 'plane_bulk_delete_milestones',
  name: 'Plane Bulk delete milestones',
  description: 'Bulk delete milestones in Plane. Requires API v2.',
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
        'The project the milestones belong to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    ids: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The ids of the milestones to delete. Between 1 and **50** per call. A value that isn't a UUID is a `400` for the whole envelope, not a failed row.",
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/milestones/bulk-delete/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          ids: { key: 'ids', type: 'array', required: true },
          all_or_none: { key: 'all_or_none', type: 'boolean', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2BulkDeleteMilestonesresultSchema),
  outputs: { result: PLANEV2V2BULKDELETEMILESTONESRESULT_OUTPUT },
}
