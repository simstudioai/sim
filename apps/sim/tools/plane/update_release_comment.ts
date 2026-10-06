import { PLANEV2RELEASECOMMENTS9A1F27_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ReleaseComments9a1f27Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateReleaseCommentParams,
  PlaneUpdateReleaseCommentResponse,
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

export const planeUpdateReleaseCommentTool: ToolConfig<
  PlaneUpdateReleaseCommentParams,
  PlaneUpdateReleaseCommentResponse
> = {
  id: 'plane_update_release_comment',
  name: 'Plane Update a release comment',
  description: 'Update a release comment in Plane. Supports API v1 compatibility.',
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
      description: 'The release comment id.',
    },
    comment_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The comment html.',
    },
    is_resolved: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is resolved.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related parent. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `comment_html`, `comment_id`, `created_at`, `created_by_id`, `edited_at`, `id`, `is_hidden`, `is_resolved`, `parent_id`, `release_id`.',
    },
    edited_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Timestamp when the comment was last edited, in ISO 8601 format.',
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
              'release_id',
              'pk',
              'comment_html',
              'parent_id',
              'is_resolved',
              'edited_at',
            ]
          : [
              'workspace_slug',
              'release_id',
              'pk',
              'comment_html',
              'is_resolved',
              'parent_id',
              'fields',
            ],
        [
          'workspace_slug',
          'release_id',
          'pk',
          'comment_html',
          'is_resolved',
          'parent_id',
          'fields',
          'edited_at',
        ],
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
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              comment_html: { key: 'comment_html', type: 'string', required: false },
              parent: { key: 'parent_id', type: 'string', required: false },
              is_resolved: { key: 'is_resolved', type: 'boolean', required: false },
              edited_at: { key: 'edited_at', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              comment_html: { key: 'comment_html', type: 'string', required: false },
              is_resolved: { key: 'is_resolved', type: 'boolean', required: false },
              parent_id: { key: 'parent_id', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2ReleaseComments9a1f27Schema)
      : planeObjectResponse(response, planeV2ReleaseComments9a1f27Schema),
  outputs: { result: PLANEV2RELEASECOMMENTS9A1F27_OUTPUT },
}
