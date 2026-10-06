import {
  PLANEV2V2LISTATTACHMENTSRESULT_OUTPUT,
  WORKITEMATTACHMENT28F0BA_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ListAttachmentsresultSchema,
  workItemAttachment28f0baSchema,
} from '@/tools/plane/schemas'
import type { PlaneListAttachmentsParams, PlaneListAttachmentsResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeListAttachmentsTool: ToolConfig<
  PlaneListAttachmentsParams,
  PlaneListAttachmentsResponse
> = {
  id: 'plane_list_attachments',
  name: 'Plane List attachments',
  description: 'List attachments in Plane. Supports API v1 compatibility.',
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
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    work_item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The work item the resource hangs off. Accepts the work item UUID or its `PROJ-123` identifier.',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to skip the total_count COUNT(\\*) (omits total_count).',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `external_id`.',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `external_source`.',
    },
    is_uploaded: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by `is_uploaded`.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip from the start of the result set.',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Field to order the list by. Prefix with '-' for descending (e.g. '-created_at'). Annotation-backed orders sort semantically and ride the default offset page.",
    },
    paginate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Set to 'cursor' to opt into the COUNT-free keyset cursor envelope (use for deep traversal); omit for the default offset envelope with total_count. One of `cursor`.",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size (max 200).',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated list of fields to return. Unrequested keys are **omitted** from each row, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400` that names the valid set, so a typo can't silently cost you the saving. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields). Requestable here: `asset_url`, `attributes`, `content_type`, `created_at`, `created_by_id`, `external_id`, `external_source`, `id`, `is_uploaded`, `name`, `size`, `work_item_id`.",
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cursor from next_cursor. Repeat the original filters, per_page, and order_by when following it.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['work_item_id', 'project_id', 'workspace_slug']
          : [
              'workspace_slug',
              'project_id',
              'work_item_id',
              'count',
              'external_id',
              'external_source',
              'is_uploaded',
              'offset',
              'order_by',
              'paginate',
              'per_page',
              'fields',
              'cursor',
            ],
        [
          'workspace_slug',
          'project_id',
          'work_item_id',
          'count',
          'external_id',
          'external_source',
          'is_uploaded',
          'offset',
          'order_by',
          'paginate',
          'per_page',
          'fields',
          'cursor',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/attachments/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/attachments/`,
            planeVersionedValues(params, {
              count: { key: 'count', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              is_uploaded: { key: 'is_uploaded', type: 'boolean', required: false },
              offset: { key: 'offset', type: 'integer', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              paginate: { key: 'paginate', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              cursor: { key: 'cursor', type: 'string', required: false },
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
      ? planeListResponse(response, workItemAttachment28f0baSchema, false, false)
      : planeObjectResponse(response, planeV2V2ListAttachmentsresultSchema),
  outputs: {
    result: PLANEV2V2LISTATTACHMENTSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: WORKITEMATTACHMENT28F0BA_OUTPUT.type,
        description: WORKITEMATTACHMENT28F0BA_OUTPUT.description,
        properties: WORKITEMATTACHMENT28F0BA_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
