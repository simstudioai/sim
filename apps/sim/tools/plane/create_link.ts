import { PLANEV2WORKITEMLINKSBF8B88_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemLinksbf8b88Schema } from '@/tools/plane/schemas'
import type { PlaneCreateLinkParams, PlaneCreateLinkResponse } from '@/tools/plane/types'
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

export const planeCreateLinkTool: ToolConfig<PlaneCreateLinkParams, PlaneCreateLinkResponse> = {
  id: 'plane_create_link',
  name: 'Plane Create a link',
  description: 'Create a link in Plane. Supports API v1 compatibility.',
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
    url: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Target URL.' },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON metadata object for the link. API v2 only.',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title. Maximum 255 characters. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `id`, `metadata`, `title`, `url`, `work_item_id`.',
    },
    created_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Original creator user ID for imports.',
    },
    issue_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Work item ID for the link.',
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
              'title',
              'url',
              'created_by',
              'issue_id',
            ]
          : ['workspace_slug', 'project_id', 'work_item_id', 'url', 'metadata', 'title', 'fields'],
        [
          'workspace_slug',
          'project_id',
          'work_item_id',
          'url',
          'metadata',
          'title',
          'fields',
          'created_by',
          'issue_id',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/links/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/links/`,
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
              title: { key: 'title', type: 'string', required: false },
              url: { key: 'url', type: 'string', required: true },
              created_by: { key: 'created_by', type: 'string', required: false },
              issue_id: { key: 'issue_id', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              url: { key: 'url', type: 'string', required: true },
              metadata: { key: 'metadata', type: 'object', required: false },
              title: { key: 'title', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkItemLinksbf8b88Schema)
      : planeObjectResponse(response, planeV2WorkItemLinksbf8b88Schema),
  outputs: { result: PLANEV2WORKITEMLINKSBF8B88_OUTPUT },
}
