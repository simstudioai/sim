import { PLANEV2WORKITEMPROPERTYOPTIONSF0877F_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertyOptionsf0877fSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreatePropertyOptionParams,
  PlaneCreatePropertyOptionResponse,
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

export const planeCreatePropertyOptionTool: ToolConfig<
  PlaneCreatePropertyOptionParams,
  PlaneCreatePropertyOptionResponse
> = {
  id: 'plane_create_property_option',
  name: 'Plane Create a property option',
  description: 'Create a property option in Plane. Supports API v1 compatibility.',
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
        'The property to add the option to. It must be an `OPTION` property in this project — a property id from another project returns `404`.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The label shown in the picker, for example `Blocker`. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Free-form explanation of what the option means. Worth filling in when the label alone doesn't tell someone when to choose it.",
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Make this the option that is preselected when a work item is created without an explicit value for this property. Defaults to `false`.',
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
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable. Send it alongside `external_id` — an `external_id` is only unique within its source.',
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
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/options/`
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
              name: { key: 'name', type: 'string', required: true },
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
