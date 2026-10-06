import { PLANEV2ARTIFACTS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ArtifactsSchema } from '@/tools/plane/schemas'
import type { PlaneCreateArtifactParams, PlaneCreateArtifactResponse } from '@/tools/plane/types'
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

export const planeCreateArtifactTool: ToolConfig<
  PlaneCreateArtifactParams,
  PlaneCreateArtifactResponse
> = {
  id: 'plane_create_artifact',
  name: 'Plane Create an artifact',
  description: 'Create an artifact in Plane. Requires API v2.',
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
    html: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The rendered HTML for version 1. This is the only genuinely required field — an empty or missing value is a `400`.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display name. Truncated to 255 characters. Falls back to `Untitled dashboard` when omitted, empty, or whitespace — it never rejects a missing name.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description. Truncated to 2000 characters rather than rejected.',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The prompt that produced this HTML, stored against the version for provenance. Not returned by any read endpoint.',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optionally scope the artifact to a project. Note the field is `project`, not `project_id` — the `*_id` convention used elsewhere in v2 does not apply on this surface.',
    },
    data_mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "How the artifact's data is sourced. One of `snapshot` (frozen at generation time) or `live` (re-read on view). Defaults to `snapshot`. Any other value is a `400`.",
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/artifacts/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          html: { key: 'html', type: 'string', required: true },
          name: { key: 'name', type: 'string', required: false },
          description: { key: 'description', type: 'string', required: false },
          prompt: { key: 'prompt', type: 'string', required: false },
          project: { key: 'project', type: 'string', required: false },
          data_mode: { key: 'data_mode', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2ArtifactsSchema),
  outputs: { result: PLANEV2ARTIFACTS_OUTPUT },
}
