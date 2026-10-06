import { PLANEV2STATESD0D9CB_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Statesd0d9cbSchema } from '@/tools/plane/schemas'
import type { PlaneCreateStateParams, PlaneCreateStateResponse } from '@/tools/plane/types'
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

export const planeCreateStateTool: ToolConfig<PlaneCreateStateParams, PlaneCreateStateResponse> = {
  id: 'plane_create_state',
  name: 'Plane Create a state',
  description: 'Create a state in Plane. Supports API v1 compatibility.',
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
      description: 'The project to add the state to.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the state, unique within the project. Maximum 255 characters.',
    },
    color: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Hex color used wherever the state is rendered, for example `#3f76ff`. Maximum 255 characters.',
    },
    group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The workflow group the state belongs to. Determines how the state is treated by boards, charts, and cycle progress. - `backlog` — Not yet scheduled - `unstarted` — Scheduled but not begun - `started` — Actively in progress - `completed` — Finished successfully - `cancelled` — Closed without completion - `triage` — Awaiting intake review Defaults to `backlog` when omitted.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description of what the state means in this workflow.',
    },
    sequence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ordering weight within the project. Lower values sort first. Assigned automatically when omitted.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Make this the project's default state — where work items land when no `state_id` is supplied. Setting it clears the flag on the previous default.",
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
              'name',
              'color',
              'group',
              'description',
              'sequence',
              'is_default',
              'external_id',
              'external_source',
              'fields',
            ],
        [
          'workspace_slug',
          'project_id',
          'name',
          'color',
          'group',
          'description',
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
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/states/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/states/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
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
              color: { key: 'color', type: 'string', required: true },
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
              name: { key: 'name', type: 'string', required: true },
              color: { key: 'color', type: 'string', required: true },
              group: { key: 'group', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
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
