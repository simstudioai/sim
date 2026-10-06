import { PLANEV2MODULES939F54_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Modules939f54Schema } from '@/tools/plane/schemas'
import type { PlaneUpdateModuleParams, PlaneUpdateModuleResponse } from '@/tools/plane/types'
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

export const planeUpdateModuleTool: ToolConfig<PlaneUpdateModuleParams, PlaneUpdateModuleResponse> =
  {
    id: 'plane_update_module',
    name: 'Plane Update a module',
    description: 'Update a module in Plane. Supports API v1 compatibility.',
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
        description: 'The project the module belongs to.',
      },
      pk: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The module to update.',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "New display name, unique within the project. Maximum 255 characters. Renaming onto an existing module's name returns `409 conflict`.",
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Plain-text summary of what the module covers.',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Move the module to a different lifecycle position. - `backlog` — Captured, not yet committed to - `planned` — Committed to but not started - `in-progress` — Actively being worked on - `paused` — Started, then put on hold - `completed` — Delivered - `cancelled` — Dropped without delivering Any value outside this list is a `400 invalid_request`. Transitions are unrestricted — a `completed` module can be sent back to `in-progress`.',
      },
      start_date: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Date the module is scheduled to begin, as `YYYY-MM-DD`. Send `null` to clear it.',
      },
      target_date: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Date the module is expected to land, as `YYYY-MM-DD`. Send `null` to clear it. Must not be earlier than the module's `start_date` — including the `start_date` already stored when you only send `target_date`.",
      },
      lead_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Reassign the module. Must be a member of this project — any other user id is rejected with a `400` naming `lead_id`. Send `null` to leave the module without a lead.',
      },
      sort_order: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Ordering weight used when modules are listed. Lower values sort first.',
      },
      logo_props: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Free-form JSON object holding the icon Plane renders for the module. The value you send replaces the stored object.',
      },
      external_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "Your system's identifier for this module, for sync and import correlation. Maximum 255 characters. Nullable.",
      },
      external_source: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `id`, `lead_id`, `logo_props`, `member_ids`, `name`, `sort_order`, `start_date`, `status`, `target_date`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated relations to embed alongside the ids: `lead` (the module lead), `members` (the module members). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.',
      },
      members: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'v1 compatibility only. Members.',
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
                'workspace_slug',
                'name',
                'description',
                'start_date',
                'target_date',
                'status',
                'lead_id',
                'members',
                'external_source',
                'external_id',
              ]
            : [
                'workspace_slug',
                'project_id',
                'pk',
                'name',
                'description',
                'status',
                'start_date',
                'target_date',
                'lead_id',
                'sort_order',
                'logo_props',
                'external_id',
                'external_source',
                'fields',
                'expand',
              ],
          [
            'workspace_slug',
            'project_id',
            'pk',
            'name',
            'description',
            'status',
            'start_date',
            'target_date',
            'lead_id',
            'sort_order',
            'logo_props',
            'external_id',
            'external_source',
            'fields',
            'expand',
            'members',
          ],
          version
        )
        return version === 'v1'
          ? planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/${safeUrlPathSegment(params.pk, 'pk')}/`
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/${safeUrlPathSegment(params.pk, 'pk')}/`,
              planeVersionedValues(params, {
                fields: { key: 'fields', type: 'string', required: false },
                expand: { key: 'expand', type: 'string', required: false },
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
                name: { key: 'name', type: 'string', required: false },
                description: { key: 'description', type: 'string', required: false },
                start_date: { key: 'start_date', type: 'string', required: false },
                target_date: { key: 'target_date', type: 'string', required: false },
                status: { key: 'status', type: 'string', required: false },
                lead: { key: 'lead_id', type: 'string', required: false },
                members: { key: 'members', type: 'array', required: false },
                external_source: { key: 'external_source', type: 'string', required: false },
                external_id: { key: 'external_id', type: 'string', required: false },
              },
              params.bodyOverrides
            )
          : planeVersionedValues(
              params,
              {
                name: { key: 'name', type: 'string', required: false },
                description: { key: 'description', type: 'string', required: false },
                status: { key: 'status', type: 'string', required: false },
                start_date: { key: 'start_date', type: 'string', required: false },
                target_date: { key: 'target_date', type: 'string', required: false },
                lead_id: { key: 'lead_id', type: 'string', required: false },
                sort_order: { key: 'sort_order', type: 'number', required: false },
                logo_props: { key: 'logo_props', type: 'json', required: false },
                external_id: { key: 'external_id', type: 'string', required: false },
                external_source: { key: 'external_source', type: 'string', required: false },
              },
              params.bodyOverrides
            ),
    },
    transformResponse: async (response, params) =>
      planeApiVersion(params?.apiVersion, true) === 'v1'
        ? planeObjectResponse(response, planeV2Modules939f54Schema)
        : planeObjectResponse(response, planeV2Modules939f54Schema),
    outputs: { result: PLANEV2MODULES939F54_OUTPUT },
  }
