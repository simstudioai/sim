import { PLANEV2RELEASETAGSB985E4_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseTagsb985e4Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateReleaseTagParams,
  PlaneUpdateReleaseTagResponse,
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

export const planeUpdateReleaseTagTool: ToolConfig<
  PlaneUpdateReleaseTagParams,
  PlaneUpdateReleaseTagResponse
> = {
  id: 'plane_update_release_tag',
  name: 'Plane Update a release tag',
  description: 'Update a release tag in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The release tag id.',
    },
    commit_hash: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The commit hash. Maximum 255 characters. Nullable.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description. Nullable.',
    },
    git_tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The git tag. Maximum 255 characters. Nullable.',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version string, for example `1.4.0`. Maximum 255 characters.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `commit_hash`, `created_at`, `created_by_id`, `description`, `git_tag`, `id`, `version`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'version', 'description', 'commit_hash', 'git_tag']
          : ['workspace_slug', 'pk', 'commit_hash', 'description', 'git_tag', 'version', 'fields'],
        ['workspace_slug', 'pk', 'commit_hash', 'description', 'git_tag', 'version', 'fields'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/tags/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/tags/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              version: { key: 'version', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              commit_hash: { key: 'commit_hash', type: 'string', required: false },
              git_tag: { key: 'git_tag', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              commit_hash: { key: 'commit_hash', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              git_tag: { key: 'git_tag', type: 'string', required: false },
              version: { key: 'version', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2ReleaseTagsb985e4Schema)
      : planeObjectResponse(response, planeV2ReleaseTagsb985e4Schema),
  outputs: { result: PLANEV2RELEASETAGSB985E4_OUTPUT },
}
