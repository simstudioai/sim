import { PLANEV2WORKITEMACTIVITIES7D9718_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemActivities7d9718Schema } from '@/tools/plane/schemas'
import type { PlaneGetActivityParams, PlaneGetActivityResponse } from '@/tools/plane/types'
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

export const planeGetActivityTool: ToolConfig<PlaneGetActivityParams, PlaneGetActivityResponse> = {
  id: 'plane_get_activity',
  name: 'Plane Get an activity',
  description: 'Get an activity in Plane. Supports API v1 compatibility.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The activity id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `actor_id`, `comment`, `created_at`, `duration`, `epoch`, `external_id`, `external_source`, `field`, `id`, `issue_comment_id`, `new_identifier_id`, `new_value`, `old_identifier_id`, `old_value`, `verb`, `work_item_id`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `actor`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Pagination cursor for getting next set of results',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "v1 compatibility only. Field to order results by. Prefix with '-' for descending order",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Number of results per page (default: 20, max: 100)',
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
              'pk',
              'project_id',
              'workspace_slug',
              'cursor',
              'expand',
              'fields',
              'order_by',
              'per_page',
            ]
          : ['workspace_slug', 'project_id', 'work_item_id', 'pk', 'fields', 'expand'],
        [
          'workspace_slug',
          'project_id',
          'work_item_id',
          'pk',
          'fields',
          'expand',
          'cursor',
          'order_by',
          'per_page',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/activities/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              cursor: { key: 'cursor', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
              fields: { key: 'fields', type: 'string', required: false },
              order_by: { key: 'order_by', type: 'string', required: false },
              per_page: { key: 'per_page', type: 'integer', required: false },
            })
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/activities/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
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
      ? planeObjectResponse(response, planeV2WorkItemActivities7d9718Schema)
      : planeObjectResponse(response, planeV2WorkItemActivities7d9718Schema),
  outputs: { result: PLANEV2WORKITEMACTIVITIES7D9718_OUTPUT },
}
