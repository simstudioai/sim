import { PLANEV2WORKSPACEWORKITEMPROPERTIES_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceWorkItemPropertiesSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkspaceWorkItemPropertyParams,
  PlaneUpdateWorkspaceWorkItemPropertyResponse,
} from '@/tools/plane/types'
import {
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

export const planeUpdateWorkspaceWorkItemPropertyTool: ToolConfig<
  PlaneUpdateWorkspaceWorkItemPropertyParams,
  PlaneUpdateWorkspaceWorkItemPropertyResponse
> = {
  id: 'plane_update_workspace_work_item_property',
  name: 'Plane Update a workspace work item property',
  description: 'Update a workspace work item property in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The property's id.",
    },
    display_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The label shown wherever the property is rendered. Maximum 255 characters. Renaming is safe for integrations that key on `id`.',
    },
    property_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. Changing the type of a property that is already collecting values reinterprets what those values mean — prefer retiring the old property with `is_active: false` and creating a new one.',
    },
    relation_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For a `RELATION` property, what it points at. One of `ISSUE`, `USER`, `RELEASE`, or `RICH_TEXT`. Nullable.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form explanation of what the property captures. Nullable — send `null` to clear it.',
    },
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether a value must be supplied for this property.',
    },
    is_multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the property accepts more than one value.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `false` to retire the property without deleting it, and back to `true` to bring it into circulation again.',
    },
    default_value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The value applied when none is supplied. Always an array. Send `[]` to clear it.',
    },
    options: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Write-only. For day-to-day option management — adding one choice, renaming another — use [Property options](/api-reference/v2/workspace-work-item-property-options/overview), which addresses each option by id.',
    },
    settings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type-specific configuration. Its shape depends on `property_type`.',
    },
    validation_rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type-specific validation configuration.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Your system's identifier for this property. Maximum 255 characters, nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The system `external_id` came from. Maximum 255 characters, nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `created_at`, `default_value`, `description`, `display_name`, `external_id`, `external_source`, `id`, `is_active`, `is_multi`, `is_required`, `logo_props`, `name`, `options`, `property_type`, `relation_type`, `settings`, `validation_rules`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          display_name: { key: 'display_name', type: 'string', required: false },
          property_type: { key: 'property_type', type: 'string', required: false },
          relation_type: { key: 'relation_type', type: 'string', required: false },
          description: { key: 'description', type: 'string', required: false },
          is_required: { key: 'is_required', type: 'boolean', required: false },
          is_multi: { key: 'is_multi', type: 'boolean', required: false },
          is_active: { key: 'is_active', type: 'boolean', required: false },
          default_value: { key: 'default_value', type: 'array', required: false },
          options: { key: 'options', type: 'array', required: false },
          settings: { key: 'settings', type: 'json', required: false },
          validation_rules: { key: 'validation_rules', type: 'json', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkspaceWorkItemPropertiesSchema),
  outputs: { result: PLANEV2WORKSPACEWORKITEMPROPERTIES_OUTPUT },
}
