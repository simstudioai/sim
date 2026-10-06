import { PLANEV2WORKITEMPROPERTIES_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertiesSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkItemPropertyParams,
  PlaneCreateWorkItemPropertyResponse,
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

export const planeCreateWorkItemPropertyTool: ToolConfig<
  PlaneCreateWorkItemPropertyParams,
  PlaneCreateWorkItemPropertyResponse
> = {
  id: 'plane_create_work_item_property',
  name: 'Plane Create a work item property',
  description: 'Create a work item property in Plane. Requires API v2.',
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
        'The project to define the property in. Project-level properties belong to this project alone.',
    },
    display_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The human-readable label for the field, for example `Severity`. Maximum 255 characters. Plane derives the read-only `name` slug from this value and returns both.',
    },
    property_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'What kind of data the field holds. This is the decision that shapes everything else about the property. - `TEXT` — Free-form text - `DATETIME` — A point in time, written as an ISO 8601 timestamp - `DECIMAL` — A number, carried as a string in the value array - `BOOLEAN` — A yes/no flag - `OPTION` — A choice from a fixed set you define - `RELATION` — A reference to another record; pair it with `relation_type` - `URL` — A link - `EMAIL` — An email address - `FILE` — An uploaded file - `FORMULA` — A value Plane computes rather than one a person enters The full reference, including what each type means for the value you send on a work item, is on the [properties overview](/api-reference/v2/work-item-properties/overview#property-type-reference).',
    },
    relation_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'What a `RELATION` property points at. Only meaningful when `property_type` is `RELATION` — leave it out otherwise. - `ISSUE` — A work item - `USER` — A member - `RELEASE` — A release - `RICH_TEXT` — Rich text content',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form explanation of what the field is for. Worth filling in — it is the helper text people read when deciding what to type.',
    },
    options: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Write-only. Define the choices for an `OPTION` property inline, in the same request that creates it, instead of a second round-trip per choice. Each entry is a property option object — `name` is required, and `description`, `is_default`, `external_id`, and `external_source` are accepted. See [Create a property option](/api-reference/v2/work-item-property-options/create-property-option) for the full field list. You never get `options` back in the shape you sent it. The response carries the resolved `options` array, with each choice's generated `id` and `sort_order`.",
    },
    is_multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Allow more than one value on a work item — a multi-select list of severities, a set of reviewers, several linked work items. Leave it off for a single-valued field.',
    },
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Force a value to be present. Give a required property a `default_value` so existing flows have something to fall back on.',
    },
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the property is offered. Create it inactive if you want to define the field and its options now but roll it out later.',
    },
    default_value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The value applied when none is supplied. **Always an array**, even for a single-valued property — a `DECIMAL` field that defaults to `3` is sent as `["3"]`, not `3`. A property with no default sends `[]` or omits the field. For an `OPTION` property, mark the default choice with `is_default` on the option itself rather than repeating it here.',
    },
    settings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form object holding type-specific configuration. What belongs in it depends entirely on `property_type`, so there is no single schema — send the whole object rather than assuming keys.',
    },
    validation_rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form object holding type-specific validation constraints. Same shape caveat as `settings`.',
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-properties/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          display_name: { key: 'display_name', type: 'string', required: true },
          property_type: { key: 'property_type', type: 'string', required: true },
          relation_type: { key: 'relation_type', type: 'string', required: false },
          description: { key: 'description', type: 'string', required: false },
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
    planeObjectResponse(response, planeV2WorkItemPropertiesSchema),
  outputs: { result: PLANEV2WORKITEMPROPERTIES_OUTPUT },
}
