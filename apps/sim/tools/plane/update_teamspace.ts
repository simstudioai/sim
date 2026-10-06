import { PLANEV2TEAMSPACES5A249D_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Teamspaces5a249dSchema } from '@/tools/plane/schemas'
import type { PlaneUpdateTeamspaceParams, PlaneUpdateTeamspaceResponse } from '@/tools/plane/types'
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

export const planeUpdateTeamspaceTool: ToolConfig<
  PlaneUpdateTeamspaceParams,
  PlaneUpdateTeamspaceResponse
> = {
  id: 'plane_update_teamspace',
  name: 'Plane Update a teamspace',
  description: 'Update a teamspace in Plane. Supports API v1 compatibility.',
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
      description: 'The teamspace id.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    lead_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related lead. Nullable.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand. Nullable.',
    },
    member_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the members to associate. Replaces the current set.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    project_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the projects to associate. Replaces the current set.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description_html`, `id`, `lead_id`, `logo_props`, `member_ids`, `name`, `project_ids`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `lead`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    description_json: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. JSON description of the teamspace. Send an object, not a string.',
    },
    description_stripped: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Plain-text version of the description.',
    },
    v1_logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Logo of the teamspace. Send an object with `in_use` set to `emoji` or `icon`, plus a matching `emoji` or `icon` object.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'workspace_slug',
              'pk',
              'name',
              'description_html',
              'description_json',
              'description_stripped',
              'v1_logo_props',
              'lead_id',
            ]
          : [
              'workspace_slug',
              'pk',
              'description_html',
              'lead_id',
              'logo_props',
              'member_ids',
              'name',
              'project_ids',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'pk',
          'description_html',
          'lead_id',
          'logo_props',
          'member_ids',
          'name',
          'project_ids',
          'fields',
          'expand',
          'description_json',
          'description_stripped',
          'v1_logo_props',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/teamspaces/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/teamspaces/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
              description_html: { key: 'description_html', type: 'string', required: false },
              description_json: { key: 'description_json', type: 'object', required: false },
              description_stripped: {
                key: 'description_stripped',
                type: 'string',
                required: false,
              },
              logo_props: { key: 'v1_logo_props', type: 'object', required: false },
              lead: { key: 'lead_id', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              description_html: { key: 'description_html', type: 'string', required: false },
              lead_id: { key: 'lead_id', type: 'string', required: false },
              logo_props: { key: 'logo_props', type: 'string', required: false },
              member_ids: { key: 'member_ids', type: 'array', required: false },
              name: { key: 'name', type: 'string', required: false },
              project_ids: { key: 'project_ids', type: 'array', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Teamspaces5a249dSchema)
      : planeObjectResponse(response, planeV2Teamspaces5a249dSchema),
  outputs: { result: PLANEV2TEAMSPACES5A249D_OUTPUT },
}
