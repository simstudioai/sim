import { PLANEV2ARTIFACTS646EAE_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Artifacts646eaeSchema } from '@/tools/plane/schemas'
import type { PlaneGetArtifactParams, PlaneGetArtifactResponse } from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetArtifactTool: ToolConfig<PlaneGetArtifactParams, PlaneGetArtifactResponse> = {
  id: 'plane_get_artifact',
  name: 'Plane Get an artifact',
  description: 'Get an artifact in Plane. Requires API v2.',
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
    artifact_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The artifact to read. UUID only — this route has no human-readable key.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/artifacts/${safeUrlPathSegment(params.artifact_id, 'artifact_id')}/`
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2Artifacts646eaeSchema),
  outputs: { result: PLANEV2ARTIFACTS646EAE_OUTPUT },
}
