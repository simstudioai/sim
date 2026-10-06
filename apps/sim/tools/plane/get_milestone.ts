import { PLANEV2MILESTONES9079DC_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Milestones9079dcSchema } from '@/tools/plane/schemas'
import type { PlaneGetMilestoneParams, PlaneGetMilestoneResponse } from '@/tools/plane/types'
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

export const planeGetMilestoneTool: ToolConfig<PlaneGetMilestoneParams, PlaneGetMilestoneResponse> =
  {
    id: 'plane_get_milestone',
    name: 'Plane Get a milestone',
    description: 'Get a milestone in Plane. Supports API v1 compatibility.',
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
      pk: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The milestone id.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `created_at`, `created_by_id`, `external_id`, `external_source`, `id`, `target_date`, `title`.',
      },
    },
    request: {
      url: (params) => {
        const version = planeApiVersion(params.apiVersion, true)
        assertPlaneVersionFields(
          params,
          version === 'v1'
            ? ['pk', 'project_id', 'workspace_slug']
            : ['workspace_slug', 'project_id', 'pk', 'fields'],
          ['workspace_slug', 'project_id', 'pk', 'fields'],
          version
        )
        return version === 'v1'
          ? planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/milestones/${safeUrlPathSegment(params.pk, 'pk')}/`
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/milestones/${safeUrlPathSegment(params.pk, 'pk')}/`,
              planeVersionedValues(params, {
                fields: { key: 'fields', type: 'string', required: false },
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
        ? planeObjectResponse(response, planeV2Milestones9079dcSchema)
        : planeObjectResponse(response, planeV2Milestones9079dcSchema),
    outputs: { result: PLANEV2MILESTONES9079DC_OUTPUT },
  }
