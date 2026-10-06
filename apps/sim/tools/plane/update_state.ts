import { PLANEV2STATESD0D9CB_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Statesd0d9cbSchema } from '@/tools/plane/schemas'
import type { PlaneUpdateStateParams, PlaneUpdateStateResponse } from '@/tools/plane/types'
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

export const planeUpdateStateTool: ToolConfig<PlaneUpdateStateParams, PlaneUpdateStateResponse> = {
  id: 'plane_update_state',
  name: 'Plane Update a state',
  description: 'Update a state in Plane. Supports API v1 compatibility.',
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
      description: 'The project the state belongs to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The id of the state to update.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New display name, unique within the project. Maximum 255 characters. Renaming is safe for reporting: boards and charts key off `group`, not `name`.',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hex color used wherever the state is rendered, for example `#3f76ff`. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description of what the state means in this workflow.',
    },
    group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Move the state to a different workflow group. This changes how every work item in the state is counted by boards, charts, and cycle progress, so switching a state from `started` to `completed` retroactively changes what those work items report as. - `backlog` — Not yet scheduled - `unstarted` — Scheduled but not begun - `started` — Actively in progress - `completed` — Finished successfully - `cancelled` — Closed without completion - `triage` — Awaiting intake review',
    },
    sequence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ordering weight within the project. Lower values sort first. Set it to reposition the state in the workflow.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Make this the project's default state — where work items land when no `state_id` is supplied. A project has exactly one default, so setting this to `true` clears the flag on the state that held it.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this state, for sync and import correlation. Maximum 255 characters.",
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
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `color`, `created_at`, `created_by_id`, `description`, `external_id`, `external_source`, `group`, `id`, `is_default`, `is_triage`, `name`, `sequence`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
    is_triage: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Is triage.',
    },
    default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Default.',
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
              'pk',
              'name',
              'description',
              'color',
              'sequence',
              'group',
              'is_triage',
              'default',
              'external_source',
              'external_id',
            ]
          : [
              'workspace_slug',
              'project_id',
              'pk',
              'name',
              'color',
              'description',
              'group',
              'sequence',
              'is_default',
              'external_id',
              'external_source',
              'fields',
            ],
        [
          'workspace_slug',
          'project_id',
          'pk',
          'name',
          'color',
          'description',
          'group',
          'sequence',
          'is_default',
          'external_id',
          'external_source',
          'fields',
          'is_triage',
          'default',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/states/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/states/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
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
              color: { key: 'color', type: 'string', required: false },
              sequence: { key: 'sequence', type: 'number', required: false },
              group: { key: 'group', type: 'string', required: false },
              is_triage: { key: 'is_triage', type: 'boolean', required: false },
              default: { key: 'default', type: 'boolean', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: false },
              color: { key: 'color', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              group: { key: 'group', type: 'string', required: false },
              sequence: { key: 'sequence', type: 'number', required: false },
              is_default: { key: 'is_default', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Statesd0d9cbSchema)
      : planeObjectResponse(response, planeV2Statesd0d9cbSchema),
  outputs: { result: PLANEV2STATESD0D9CB_OUTPUT },
}
