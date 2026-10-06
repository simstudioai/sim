import { PLANEV2WORKSPACEASSETS33620D_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceAssets33620dSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkspaceAssetParams,
  PlaneCreateWorkspaceAssetResponse,
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

export const planeCreateWorkspaceAssetTool: ToolConfig<
  PlaneCreateWorkspaceAssetParams,
  PlaneCreateWorkspaceAssetResponse
> = {
  id: 'plane_create_workspace_asset',
  name: 'Plane Create a workspace asset upload',
  description: 'Create a workspace asset upload in Plane. Supports API v1 compatibility.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name.',
    },
    size: { type: 'number', required: true, visibility: 'user-or-llm', description: 'The size.' },
    entity_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The entity type.',
    },
    type: { type: 'string', required: false, visibility: 'user-or-llm', description: 'The type.' },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `asset_url`, `attributes`, `content_type`, `created_at`, `created_by_id`, `entity_type`, `external_id`, `external_source`, `id`, `is_uploaded`, `name`, `size`.',
    },
    project_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. UUID of the project to associate with the asset',
    },
    entity_identifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. UUID of the workspace page. This value and `entity_type` are required together for a `PAGE_DESCRIPTION` attachment.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. External identifier for the asset (for integration tracking)',
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. External source system (for integration tracking)',
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
              'name',
              'type',
              'size',
              'project_id',
              'entity_type',
              'entity_identifier',
              'external_id',
              'external_source',
            ]
          : ['workspace_slug', 'name', 'size', 'entity_type', 'type', 'fields'],
        [
          'workspace_slug',
          'name',
          'size',
          'entity_type',
          'type',
          'fields',
          'project_id',
          'entity_identifier',
          'external_id',
          'external_source',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/assets/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/assets/`,
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
              name: { key: 'name', type: 'string', required: true },
              type: { key: 'type', type: 'string', required: true },
              size: { key: 'size', type: 'integer', required: true },
              project_id: { key: 'project_id', type: 'string', required: false },
              entity_type: { key: 'entity_type', type: 'string', required: false },
              entity_identifier: { key: 'entity_identifier', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              size: { key: 'size', type: 'integer', required: true },
              entity_type: { key: 'entity_type', type: 'string', required: false },
              type: { key: 'type', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkspaceAssets33620dSchema)
      : planeObjectResponse(response, planeV2WorkspaceAssets33620dSchema),
  outputs: { result: PLANEV2WORKSPACEASSETS33620D_OUTPUT },
}
