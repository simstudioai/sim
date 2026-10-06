import { PLANEV2WORKITEMPROPERTYCONTEXTS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertyContextsSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdatePropertyContextParams,
  PlaneUpdatePropertyContextResponse,
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

export const planeUpdatePropertyContextTool: ToolConfig<
  PlaneUpdatePropertyContextParams,
  PlaneUpdatePropertyContextResponse
> = {
  id: 'plane_update_property_context',
  name: 'Plane Update a property context',
  description: 'Update a property context in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The id of the context to update.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "New display name, unique among this property's contexts. Maximum 255 characters.",
    },
    applies_to_all_projects: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Switch the project axis between "every project" and an explicit list. Setting it to `true` discards the context\'s stored `project_ids`, so the context reads back with an empty list. Setting it to `false` requires `project_ids` in the same request unless the context already has projects stored. Only one context per property may have this set to `true`, so turning it on while another context holds the slot returns `400`.',
    },
    project_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replace the exact set of projects this context covers. What you send becomes the whole list: ids you leave out are unlinked, and ids you add are linked. Rejected with a `400` when `applies_to_all_projects` is `true`, and when the list would be empty while the flag is `false`. Every id must belong to this workspace, and duplicates are rejected. Write-only as an input; the response echoes the stored links in `project_ids`.',
    },
    applies_to_all_work_item_types: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Switch the work item type axis between "every type" and an explicit list. Same rules as `applies_to_all_projects`: turning it on clears `issue_type_ids`, turning it off needs types to fall back on.',
    },
    issue_type_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replace the exact set of work item types this context covers. Same set-replacement semantics as `project_ids`, and the same validation against the wildcard flag.',
    },
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Whether the property must be filled in inside this scope. Replaces the property's own `is_required` here.",
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
        'Values applied when a work item in this scope has nothing set. For `OPTION` properties, options in this context flagged `is_default` take precedence over this array.',
    },
    options: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replace this context\'s option list. Entries are the same shape as on create: `id` to keep an existing option, `name` to add a new one, plus optional `description` and `is_default`. An option\'s `sort_order` is read-only — Plane assigns it from the order of the entries you send. Sending this field rewrites the list. Any option currently on the context that you do not reference by `id` is removed, along with the values recorded through it. To keep an option and change nothing about it, include `{ "id": "…" }`.',
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
        "Ordering weight among this property's contexts. Lower values sort first. Presentational only — it does not affect which context wins for a work item.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this context. Maximum 255 characters. Must be sent together with `external_source`, and the pair must be unique within the property.",
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
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/contexts/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
