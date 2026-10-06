import { PLANEV2ESTIMATEPOINTSB9F075_OUTPUT } from '@/tools/plane/outputs'
import { planeV2EstimatePointsb9f075Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateEstimatePointParams,
  PlaneUpdateEstimatePointResponse,
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

export const planeUpdateEstimatePointTool: ToolConfig<
  PlaneUpdateEstimatePointParams,
  PlaneUpdateEstimatePointResponse
> = {
  id: 'plane_update_estimate_point',
  name: 'Plane Update an estimate point',
  description: 'Update an estimate point in Plane. Supports API v1 compatibility.',
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
    estimate_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The estimate the points belong to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The estimate point id.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this record, for sync and import correlation. Maximum 255 characters. Nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable.',
    },
    key: { type: 'number', required: false, visibility: 'user-or-llm', description: 'The key.' },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The value. Maximum 255 characters.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description`, `estimate_id`, `external_id`, `external_source`, `id`, `key`, `value`.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'pk',
              'estimate_id',
              'project_id',
              'workspace_slug',
              'key',
              'value',
              'description',
              'external_id',
              'external_source',
            ]
          : [
              'workspace_slug',
              'project_id',
              'estimate_id',
              'pk',
              'description',
              'external_id',
              'external_source',
              'key',
              'value',
              'fields',
            ],
        [
          'workspace_slug',
          'project_id',
          'estimate_id',
          'pk',
          'description',
          'external_id',
          'external_source',
          'key',
          'value',
          'fields',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/estimates/${safeUrlPathSegment(params.estimate_id, 'estimate_id')}/estimate-points/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/estimates/${safeUrlPathSegment(params.estimate_id, 'estimate_id')}/points/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
              key: { key: 'key', type: 'integer', required: false },
              value: { key: 'value', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              description: { key: 'description', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              key: { key: 'key', type: 'integer', required: false },
              value: { key: 'value', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2EstimatePointsb9f075Schema)
      : planeObjectResponse(response, planeV2EstimatePointsb9f075Schema),
  outputs: { result: PLANEV2ESTIMATEPOINTSB9F075_OUTPUT },
}
