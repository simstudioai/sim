import { PLANEV2WORKITEMPROPERTYCONTEXTS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertyContextsSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreatePropertyContextParams,
  PlaneCreatePropertyContextResponse,
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

export const planeCreatePropertyContextTool: ToolConfig<
  PlaneCreatePropertyContextParams,
  PlaneCreatePropertyContextResponse
> = {
  id: 'plane_create_property_context',
  name: 'Plane Create a property context',
  description: 'Create a property context in Plane. Requires API v2.',
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
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The workspace-level property the context belongs to. A project-level property id is not addressable here and returns `404 not_found`.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Display name, unique among this property's contexts. Maximum 255 characters. Always send one — the context Plane seeded with the property already occupies the name `Default`.",
    },
    applies_to_all_projects: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `true` to cover every project in the workspace instead of listing them. Defaults to `false`, which means `project_ids` is required. Only one context per property may set this to `true`, and the seeded context normally holds that slot, so a second all-projects context returns `400`.',
    },
    project_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The exact projects this context covers. Required when `applies_to_all_projects` is `false`, and rejected with a `400` when it is `true` — the flag and the list are alternatives, never a combination. Every id must belong to this workspace, and duplicates are rejected. This field is write-only as an input, but the resulting links are echoed back in the response's read-only `project_ids`.",
    },
    applies_to_all_work_item_types: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to `true` to cover every work item type in the workspace instead of listing them. Defaults to `false`, which means `issue_type_ids` is required.',
    },
    issue_type_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The exact work item types this context covers. Required when `applies_to_all_work_item_types` is `false`, and rejected with a `400` when it is `true`. Every id must belong to this workspace, and duplicates are rejected. Write-only as an input; the response echoes the stored links in `issue_type_ids`.',
    },
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Whether the property must be filled in on work items inside this scope. This replaces the property's own `is_required` here — it does not combine with it.",
    },
    is_multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Whether the property accepts several values inside this scope. Replaces the property's own `is_multi` here.",
    },
    default_value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Values applied when a work item in this scope has nothing set. For `OPTION` properties, any option in this context flagged `is_default` takes precedence over this array.',
    },
    options: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The choices this context offers for an `OPTION` property. Options belong to a context, so this list — not the property's full option list — is what work items in this scope can pick from. Each entry either references an existing option of the property or creates a new one: - `id` _string (uuid)_ — an existing option of this property. Duplicate ids and ids from another property are rejected. - `name` _string_ — creates a new option. Maximum 255 characters. Names must be unique within the payload, case-insensitively. - `description` _string_ — free-form description of the option. - `is_default` _boolean_ — preselect this option for new work items in this scope. Defaults to `false`. Send either `id` or `name` on each entry — an entry with neither is a `400`. Write-only as an input; the response returns the resulting options with their ids. An option's own `sort_order` is read-only: Plane assigns it from the order of the entries you send, and it is returned on each option in the response.",
    },
    settings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Type-specific configuration for this scope, as a JSON object. Replaces the property's own `settings` here.",
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Ordering weight among this property's contexts. Lower values sort first. Omit it and Plane places the new context after the ones that already exist. Ordering is presentational — it does not affect which context wins.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this context, for sync and import correlation. Maximum 255 characters. Must be sent together with `external_source`, and the pair must be unique within the property.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Must be sent together with `external_id`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `applies_to_all_projects`, `applies_to_all_work_item_types`, `created_at`, `default_value`, `external_id`, `external_source`, `id`, `is_default`, `is_multi`, `is_required`, `issue_type_ids`, `name`, `options`, `project_ids`, `settings`, `sort_order`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/contexts/`,
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
          name: { key: 'name', type: 'string', required: false },
          applies_to_all_projects: {
            key: 'applies_to_all_projects',
            type: 'boolean',
            required: false,
          },
          project_ids: { key: 'project_ids', type: 'array', required: false },
          applies_to_all_work_item_types: {
            key: 'applies_to_all_work_item_types',
            type: 'boolean',
            required: false,
          },
          issue_type_ids: { key: 'issue_type_ids', type: 'array', required: false },
          is_required: { key: 'is_required', type: 'boolean', required: false },
          is_multi: { key: 'is_multi', type: 'boolean', required: false },
          default_value: { key: 'default_value', type: 'array', required: false },
          options: { key: 'options', type: 'array', required: false },
          settings: { key: 'settings', type: 'json', required: false },
          sort_order: { key: 'sort_order', type: 'number', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkItemPropertyContextsSchema),
  outputs: { result: PLANEV2WORKITEMPROPERTYCONTEXTS_OUTPUT },
}
