import { PLANEV2LABELSEEF21E_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Labelseef21eSchema } from '@/tools/plane/schemas'
import type { PlaneCreateLabelParams, PlaneCreateLabelResponse } from '@/tools/plane/types'
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

export const planeCreateLabelTool: ToolConfig<PlaneCreateLabelParams, PlaneCreateLabelResponse> = {
  id: 'plane_create_label',
  name: 'Plane Create a label',
  description: 'Create a label in Plane. Supports API v1 compatibility.',
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
      description: 'The project to add the label to.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the label, unique within the project. Maximum 255 characters.',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hex color used wherever the label is rendered, for example `#e5484d`. Maximum 255 characters. Send one if the label needs to be recognizable at a glance on a board.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form note about what the label is for and when to apply it.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The label this one nests under, for grouping related tags such as `Billing` and `Search` beneath an `Area` label. The parent must be a label in the same project — an id from another project is a `400`, not a silent link. Omit it, or send `null`, for a top-level label.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ordering weight within the project. Lower values sort first. Assigned automatically when omitted, so send it only when you are recreating a specific order.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this label, for sync and import correlation. Maximum 255 characters. Store it here and you can find the label later with `?external_id=`, without keeping a map of Plane ids.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `color`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `id`, `name`, `parent_id`, `sort_order`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'project_id',
              'workspace_slug',
              'name',
              'color',
              'description',
              'external_source',
              'external_id',
              'parent_id',
              'sort_order',
            ]
          : [
              'workspace_slug',
              'project_id',
              'name',
              'color',
              'description',
              'parent_id',
              'sort_order',
              'external_id',
              'external_source',
              'fields',
            ],
        [
          'workspace_slug',
          'project_id',
          'name',
          'color',
          'description',
          'parent_id',
          'sort_order',
          'external_id',
          'external_source',
          'fields',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/labels/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/labels/`,
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
              color: { key: 'color', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              parent: { key: 'parent_id', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              color: { key: 'color', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              parent_id: { key: 'parent_id', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Labelseef21eSchema)
      : planeObjectResponse(response, planeV2Labelseef21eSchema),
  outputs: { result: PLANEV2LABELSEEF21E_OUTPUT },
}
