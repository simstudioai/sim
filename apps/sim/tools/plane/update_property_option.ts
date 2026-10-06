import { PLANEV2WORKITEMPROPERTYOPTIONSF0877F_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertyOptionsf0877fSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdatePropertyOptionParams,
  PlaneUpdatePropertyOptionResponse,
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

export const planeUpdatePropertyOptionTool: ToolConfig<
  PlaneUpdatePropertyOptionParams,
  PlaneUpdatePropertyOptionResponse
> = {
  id: 'plane_update_property_option',
  name: 'Plane Update a property option',
  description: 'Update a property option in Plane. Supports API v1 compatibility.',
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
      description: 'The project that owns the property.',
    },
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The `OPTION` property the option belongs to. See [Work item properties](/api-reference/v2/work-item-properties/overview).',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The id of the option to update. An option id that belongs to a different property returns `404`.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New label for the option. Maximum 255 characters. Safe to change at any time: values on work items reference the option `id`, not its name.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form explanation of what the option means.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether this option is preselected when a work item is created without an explicit value for the property. Changing it affects only work items created from now on — existing values are untouched.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this option, for sync and import correlation. Maximum 255 characters. Nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Is active.',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Parent.',
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
              'project_id',
              'property_id',
              'workspace_slug',
              'name',
              'description',
              'is_active',
              'is_default',
              'external_source',
              'external_id',
              'parent',
            ]
          : [
              'workspace_slug',
              'project_id',
              'property_id',
              'pk',
              'name',
              'description',
              'is_default',
              'external_id',
              'external_source',
            ],
        [
          'workspace_slug',
          'project_id',
          'property_id',
          'pk',
          'name',
          'description',
          'is_default',
          'external_id',
          'external_source',
          'is_active',
          'parent',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/${safeUrlPathSegment(params.pk, 'pk')}/`
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
              name: { key: 'name', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              is_active: { key: 'is_active', type: 'boolean', required: false },
              is_default: { key: 'is_default', type: 'boolean', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              parent: { key: 'parent', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              is_default: { key: 'is_default', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkItemPropertyOptionsf0877fSchema)
      : planeObjectResponse(response, planeV2WorkItemPropertyOptionsf0877fSchema),
  outputs: { result: PLANEV2WORKITEMPROPERTYOPTIONSF0877F_OUTPUT },
}
