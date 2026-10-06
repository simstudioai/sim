import { PLANEV2RELEASELINKS259DD6_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseLinks259dd6Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateReleaseLinkParams,
  PlaneUpdateReleaseLinkResponse,
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

export const planeUpdateReleaseLinkTool: ToolConfig<
  PlaneUpdateReleaseLinkParams,
  PlaneUpdateReleaseLinkResponse
> = {
  id: 'plane_update_release_link',
  name: 'Plane Update a release link',
  description: 'Update a release link in Plane. Supports API v1 compatibility.',
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
    release_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The release the resource belongs to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The release link id.',
    },
    metadata: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The metadata.',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title. Maximum 255 characters.',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target URL. Maximum 200 characters.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `id`, `metadata`, `release_id`, `title`, `url`.',
    },
    v1_metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Arbitrary metadata to store alongside the link.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'release_id', 'pk', 'title', 'url', 'v1_metadata']
          : ['workspace_slug', 'release_id', 'pk', 'metadata', 'title', 'url', 'fields'],
        ['workspace_slug', 'release_id', 'pk', 'metadata', 'title', 'url', 'fields', 'v1_metadata'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.release_id, 'release_id')}/links/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.release_id, 'release_id')}/links/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
              title: { key: 'title', type: 'string', required: false },
              url: { key: 'url', type: 'string', required: false },
              metadata: { key: 'v1_metadata', type: 'object', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              metadata: { key: 'metadata', type: 'string', required: false },
              title: { key: 'title', type: 'string', required: false },
              url: { key: 'url', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2ReleaseLinks259dd6Schema)
      : planeObjectResponse(response, planeV2ReleaseLinks259dd6Schema),
  outputs: { result: PLANEV2RELEASELINKS259DD6_OUTPUT },
}
