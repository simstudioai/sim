import { PLANEV2V2PUBLISHARTIFACTRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2PublishArtifactresultSchema } from '@/tools/plane/schemas'
import type { PlanePublishArtifactParams, PlanePublishArtifactResponse } from '@/tools/plane/types'
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

export const planePublishArtifactTool: ToolConfig<
  PlanePublishArtifactParams,
  PlanePublishArtifactResponse
> = {
  id: 'plane_publish_artifact',
  name: 'Plane Publish an artifact',
  description: 'Publish an artifact in Plane. Requires API v2.',
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
      description: 'The artifact to publish. UUID only.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/artifacts/${safeUrlPathSegment(params.artifact_id, 'artifact_id')}/publish/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2PublishArtifactresultSchema),
  outputs: { result: PLANEV2V2PUBLISHARTIFACTRESULT_OUTPUT },
}
