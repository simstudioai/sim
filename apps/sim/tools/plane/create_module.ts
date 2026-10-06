import { PLANEV2MODULES29B3C8_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Modules29b3c8Schema } from '@/tools/plane/schemas'
import type { PlaneCreateModuleParams, PlaneCreateModuleResponse } from '@/tools/plane/types'
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

export const planeCreateModuleTool: ToolConfig<PlaneCreateModuleParams, PlaneCreateModuleResponse> =
  {
    id: 'plane_create_module',
    name: 'Plane Create a module',
    description: 'Create a module in Plane. Supports API v1 compatibility.',
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
        description: 'The project to create the module in.',
      },
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Display name for the module, unique within the project. Maximum 255 characters.',
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
          'Where the module sits in its lifecycle. - `backlog` — Captured, not yet committed to - `planned` — Committed to but not started - `in-progress` — Actively being worked on - `paused` — Started, then put on hold - `completed` — Delivered - `cancelled` — Dropped without delivering Defaults to `planned` when omitted. A value outside this list is a `400 invalid_request`.',
      },
      start_date: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Date the module is scheduled to begin, as `YYYY-MM-DD`. Nullable.',
      },
      target_date: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Date the module is expected to land, as `YYYY-MM-DD`. Nullable, and must not be earlier than `start_date`.',
      },
      lead_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'The user accountable for the module. Must be a member of this project — any other user id is rejected with a `400` naming `lead_id`, never linked silently. Nullable.',
      },
      sort_order: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Ordering weight used when modules are listed. Lower values sort first. In a project that already has modules, Plane positions the new module ahead of them on create, so send `sort_order` in a follow-up `PATCH` if you need a specific slot.',
      },
      logo_props: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Free-form JSON object holding the icon Plane renders for the module.',
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
          'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `id`, `lead_id`, `logo_props`, `member_ids`, `name`, `sort_order`, `start_date`, `status`, `target_date`. See [Sparse fields](/api-reference/v2/sparse-fields).',
      },
      expand: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated relations to embed alongside the ids: `lead` (the module lead), `members` (the module members). Expansion is separate-key: `?expand=state` keeps `state_id` and adds a `state` object next to it, so an id is never replaced by an object. An unknown value is a `400`. `?fields=` and `?expand=` are independent namespaces. Relation names are not valid `?fields=` tokens (and vice versa), and an expanded object survives field filtering — `?fields=id,name&expand=state` returns `id`, `name` and `state`. See [Expanding relations](/api-reference/v2/expanding-relations).',
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
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/`
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/modules/`,
              planeVersionedValues(params, {
                fields: { key: 'fields', type: 'string', required: false },
                expand: { key: 'expand', type: 'string', required: false },
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
                name: { key: 'name', type: 'string', required: true },
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
        ? planeObjectResponse(response, planeV2Modules29b3c8Schema)
        : planeObjectResponse(response, planeV2Modules29b3c8Schema),
    outputs: { result: PLANEV2MODULES29B3C8_OUTPUT },
  }
