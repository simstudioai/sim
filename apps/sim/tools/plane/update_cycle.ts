import { PLANEV2CYCLES6D6772_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Cycles6d6772Schema } from '@/tools/plane/schemas'
import type { PlaneUpdateCycleParams, PlaneUpdateCycleResponse } from '@/tools/plane/types'
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

export const planeUpdateCycleTool: ToolConfig<PlaneUpdateCycleParams, PlaneUpdateCycleResponse> = {
  id: 'plane_update_cycle',
  name: 'Plane Update a cycle',
  description: 'Update a cycle in Plane. Supports API v1 compatibility.',
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
      description: 'The project the cycle belongs to.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The cycle to update.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New display name, unique within the project. Maximum 255 characters. Renaming onto a name another cycle already holds returns `409 conflict`.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description of what the cycle covers.',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New opening date-time, in ISO 8601. Send `null` to unschedule the start.',
    },
    end_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New closing date-time, in ISO 8601. Send `null` to unschedule the end.',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The IANA time zone the cycle's dates are interpreted in, for example `America/New_York` or `UTC`. Changing it re-anchors where the existing boundaries fall locally, so send it together with the dates when you are moving a cycle between regions. Any value outside the IANA list is rejected with `400 invalid_request`.",
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ordering weight for the cycle within the project. Lower values sort first when you list with `?order_by=sort_order`.',
    },
    logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "JSON blob holding the cycle's icon configuration. Replaces the stored value outright — it is not merged key by key.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Your system's identifier for this cycle. Maximum 255 characters, nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `jira`. Maximum 255 characters, nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `created_at`, `created_by_id`, `description`, `end_date`, `external_id`, `external_source`, `id`, `logo_props`, `name`, `owned_by_id`, `sort_order`, `start_date`, `timezone`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed alongside the ids: `owned_by` (the cycle owner). Expansion is separate-key: `?expand=state` keeps `state_id` and adds a `state` object next to it, so an id is never replaced by an object. An unknown value is a `400`. `?fields=` and `?expand=` are independent namespaces. Relation names are not valid `?fields=` tokens (and vice versa), and an expanded object survives field filtering — `?fields=id,name&expand=state` returns `id`, `name` and `state`. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    owned_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. User who owns the cycle. If not provided, defaults to the current user.',
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
              'end_date',
              'owned_by',
              'external_source',
              'external_id',
              'timezone',
            ]
          : [
              'workspace_slug',
              'project_id',
              'pk',
              'name',
              'description',
              'start_date',
              'end_date',
              'timezone',
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
          'start_date',
          'end_date',
          'timezone',
          'sort_order',
          'logo_props',
          'external_id',
          'external_source',
          'fields',
          'expand',
          'owned_by',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
              end_date: { key: 'end_date', type: 'string', required: false },
              owned_by: { key: 'owned_by', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              timezone: { key: 'timezone', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              start_date: { key: 'start_date', type: 'string', required: false },
              end_date: { key: 'end_date', type: 'string', required: false },
              timezone: { key: 'timezone', type: 'string', required: false },
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
      ? planeObjectResponse(response, planeV2Cycles6d6772Schema)
      : planeObjectResponse(response, planeV2Cycles6d6772Schema),
  outputs: { result: PLANEV2CYCLES6D6772_OUTPUT },
}
