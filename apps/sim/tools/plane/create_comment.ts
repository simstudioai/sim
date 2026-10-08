import { PLANEV2WORKITEMCOMMENTS5AF051_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemComments5af051Schema } from '@/tools/plane/schemas'
import type { PlaneCreateCommentParams, PlaneCreateCommentResponse } from '@/tools/plane/types'
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

export const planeCreateCommentTool: ToolConfig<
  PlaneCreateCommentParams,
  PlaneCreateCommentResponse
> = {
  id: 'plane_create_comment',
  name: 'Plane Create a comment',
  description: 'Create a comment in Plane. Supports API v1 compatibility.',
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
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project the work item belongs to.',
    },
    work_item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The work item to comment on.',
    },
    comment_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML comment content. Required with API v2; API v1 also supports comment_json.',
    },
    access: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Visibility of the comment. - `INTERNAL` — visible to the project team - `EXTERNAL` — marked as visible outside the team, for example on a published project Omit it to take the server's default. Change it later with a `PATCH`.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this comment, for sync and import correlation. Maximum 255 characters. Accepts `null`.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `zendesk`. Maximum 255 characters. Accepts `null`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `access`, `actor_id`, `comment_html`, `comment_stripped`, `created_at`, `created_by_id`, `edited_at`, `external_id`, `external_source`, `id`, `work_item_id`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed alongside the ids: `actor` (the comment author). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
    },
    comment_json: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Comment json.',
    },
    created_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Creation timestamp for imports.',
    },
    created_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Original creator user ID for imports.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'work_item_id',
              'project_id',
              'workspace_slug',
              'comment_json',
              'comment_html',
              'access',
              'external_source',
              'external_id',
              'created_at',
              'created_by',
            ]
          : [
              'workspace_slug',
              'project_id',
              'work_item_id',
              'comment_html',
              'access',
              'external_id',
              'external_source',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'project_id',
          'work_item_id',
          'comment_html',
          'access',
          'external_id',
          'external_source',
          'fields',
          'expand',
          'comment_json',
          'created_at',
          'created_by',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/comments/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/comments/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
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
              comment_json: { key: 'comment_json', type: 'object', required: false },
              comment_html: { key: 'comment_html', type: 'string', required: false },
              access: { key: 'access', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              created_at: { key: 'created_at', type: 'string', required: false },
              created_by: { key: 'created_by', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              comment_html: { key: 'comment_html', type: 'string', required: true },
              access: { key: 'access', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkItemComments5af051Schema)
      : planeObjectResponse(response, planeV2WorkItemComments5af051Schema),
  outputs: { result: PLANEV2WORKITEMCOMMENTS5AF051_OUTPUT },
}
