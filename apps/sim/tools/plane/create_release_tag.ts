import { PLANEV2RELEASETAGSB985E4_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseTagsb985e4Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateReleaseTagParams,
  PlaneCreateReleaseTagResponse,
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

export const planeCreateReleaseTagTool: ToolConfig<
  PlaneCreateReleaseTagParams,
  PlaneCreateReleaseTagResponse
> = {
  id: 'plane_create_release_tag',
  name: 'Plane Create a release tag',
  description: 'Create a release tag in Plane. Supports API v1 compatibility.',
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
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Version string, for example `1.4.0`. Maximum 255 characters.',
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
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `commit_hash`, `created_at`, `created_by_id`, `description`, `git_tag`, `id`, `version`.',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. ID of the project to scope this release tag to. When omitted, the release tag is workspace-wide.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Name',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Color',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'workspace_slug',
              'version',
              'description',
              'commit_hash',
              'git_tag',
              'project',
              'name',
              'color',
            ]
          : ['workspace_slug', 'version', 'commit_hash', 'description', 'git_tag', 'fields'],
        [
          'workspace_slug',
          'version',
          'commit_hash',
          'description',
          'git_tag',
          'fields',
          'project',
          'name',
          'color',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/tags/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/tags/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              version: { key: 'version', type: 'string', required: true },
              description: { key: 'description', type: 'string', required: false },
              commit_hash: { key: 'commit_hash', type: 'string', required: false },
              git_tag: { key: 'git_tag', type: 'string', required: false },
              project: { key: 'project', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              color: { key: 'color', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              version: { key: 'version', type: 'string', required: true },
              commit_hash: { key: 'commit_hash', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              git_tag: { key: 'git_tag', type: 'string', required: false },
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
