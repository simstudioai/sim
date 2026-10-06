import { PLANEV2WORKITEMPROPERTIESA758D8_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertiesa758d8Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkItemPropertyParams,
  PlaneUpdateWorkItemPropertyResponse,
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

export const planeUpdateWorkItemPropertyTool: ToolConfig<
  PlaneUpdateWorkItemPropertyParams,
  PlaneUpdateWorkItemPropertyResponse
> = {
  id: 'plane_update_work_item_property',
  name: 'Plane Update a work item property',
  description: 'Update a work item property in Plane. Requires API v2.',
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
      description: 'The project the property belongs to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The id of the property to update.',
    },
    display_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New human-readable label for the field. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form explanation of what the field is for, shown as helper text.',
    },
    property_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The kind of data the field holds: `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`, or `FORMULA`. Changing the type of a property that already holds values changes what those values mean, so treat this as a migration rather than an edit — in most cases creating a new property and retiring the old one with `is_active: false` is the safer move. The full reference is on the [properties overview](/api-reference/v2/work-item-properties/overview#property-type-reference).',
    },
    relation_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'What a `RELATION` property points at: `ISSUE`, `USER`, `RELEASE`, or `RICH_TEXT`. Only meaningful when `property_type` is `RELATION`.',
    },
    options: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Write-only. Define `OPTION` choices inline, the same way you can on create. Each entry is a property option object with `name` required. For adding, editing, or removing a single choice on a live property, prefer the dedicated endpoints under [Property options](/api-reference/v2/work-item-property-options/list-property-options) — they let you address one option by id instead of restating the set. The response always returns the resolved `options` array, never the payload you sent.',
    },
    is_multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the field accepts more than one value. Turning it off on a property that already holds several values per work item is a narrowing change — check your data first.',
    },
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether a value must be present. This applies going forward: existing work items with the field empty are not rejected retroactively, but the next edit will ask for a value. Pair it with a `default_value` so automated flows have something to fall back on.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the property is offered. Setting `false` is the reversible way to retire a field — the definition, its options, and its recorded values all survive, and the field simply stops being offered.',
    },
    default_value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The value applied when none is supplied. **Always an array**, even for a single-valued property — a `DECIMAL` field that defaults to `3` is sent as `["3"]`, not `3`. Send `[]` to clear the default.',
    },
    settings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form object holding type-specific configuration. The shape depends on `property_type`, so send the whole object rather than assuming keys — a partial `settings` object replaces the stored one.',
    },
    validation_rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form object holding type-specific validation constraints. Same whole-object caveat as `settings`.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this field, for sync and import correlation. Maximum 255 characters.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `jira` or `linear`. Maximum 255 characters.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
          description: { key: 'description', type: 'string', required: false },
          property_type: { key: 'property_type', type: 'string', required: false },
          relation_type: { key: 'relation_type', type: 'string', required: false },
          options: { key: 'options', type: 'array', required: false },
          is_multi: { key: 'is_multi', type: 'boolean', required: false },
          is_required: { key: 'is_required', type: 'boolean', required: false },
          is_active: { key: 'is_active', type: 'boolean', required: false },
          default_value: { key: 'default_value', type: 'array', required: false },
          settings: { key: 'settings', type: 'json', required: false },
          validation_rules: { key: 'validation_rules', type: 'json', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkItemPropertiesa758d8Schema),
  outputs: { result: PLANEV2WORKITEMPROPERTIESA758D8_OUTPUT },
}
