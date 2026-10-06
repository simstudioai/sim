import { PLANEV2RELEASECOMMENTS9A1F27_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseComments9a1f27Schema } from '@/tools/plane/schemas'
import type {
  PlaneGetReleaseCommentParams,
  PlaneGetReleaseCommentResponse,
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

export const planeGetReleaseCommentTool: ToolConfig<
  PlaneGetReleaseCommentParams,
  PlaneGetReleaseCommentResponse
> = {
  id: 'plane_get_release_comment',
  name: 'Plane Get a release comment',
  description: 'Get a release comment in Plane. Supports API v1 compatibility.',
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
      description: 'The release comment id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `comment_html`, `comment_id`, `created_at`, `created_by_id`, `edited_at`, `id`, `is_hidden`, `is_resolved`, `parent_id`, `release_id`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'release_id', 'pk']
          : ['workspace_slug', 'release_id', 'pk', 'fields'],
        ['workspace_slug', 'release_id', 'pk', 'fields'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.release_id, 'release_id')}/comments/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.release_id, 'release_id')}/comments/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
      ? planeObjectResponse(response, planeV2ReleaseComments9a1f27Schema)
      : planeObjectResponse(response, planeV2ReleaseComments9a1f27Schema),
  outputs: { result: PLANEV2RELEASECOMMENTS9A1F27_OUTPUT },
}
