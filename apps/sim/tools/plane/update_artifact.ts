import { PLANEV2ARTIFACTS646EAE_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Artifacts646eaeSchema } from '@/tools/plane/schemas'
import type { PlaneUpdateArtifactParams, PlaneUpdateArtifactResponse } from '@/tools/plane/types'
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

export const planeUpdateArtifactTool: ToolConfig<
  PlaneUpdateArtifactParams,
  PlaneUpdateArtifactResponse
> = {
  id: 'plane_update_artifact',
  name: 'Plane Append a new version',
  description: 'Append a new version in Plane. Requires API v2.',
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
    artifact_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The artifact to append a version to. UUID only.',
    },
    html: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The rendered HTML for the new version. An empty or missing value is a `400`.',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The prompt that produced this HTML, stored against the version for provenance. Not returned by any read endpoint.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/artifacts/${safeUrlPathSegment(params.artifact_id, 'artifact_id')}/update/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          html: { key: 'html', type: 'string', required: true },
          prompt: { key: 'prompt', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2Artifacts646eaeSchema),
  outputs: { result: PLANEV2ARTIFACTS646EAE_OUTPUT },
}
