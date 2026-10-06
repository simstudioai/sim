import { PLANEV2INITIATIVES26C543_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Initiatives26c543Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateInitiativeParams,
  PlaneCreateInitiativeResponse,
} from '@/tools/plane/types'
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

export const planeCreateInitiativeTool: ToolConfig<
  PlaneCreateInitiativeParams,
  PlaneCreateInitiativeResponse
> = {
  id: 'plane_create_initiative',
  name: 'Plane Create an initiative',
  description: 'Create an initiative in Plane. Supports API v1 compatibility.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description. Nullable.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Rich-text body as HTML. This is the field the Plane editor round-trips. Nullable.',
    },
    end_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date, as `YYYY-MM-DD`. Nullable.',
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
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    project_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the projects to associate. Replaces the current set.',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start date, as `YYYY-MM-DD`. Nullable.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `DRAFT` - Draft - `PLANNED` - Planned - `ACTIVE` - Active - `COMPLETED` - Completed - `CLOSED` - Closed One of `DRAFT`, `PLANNED`, `ACTIVE`, `COMPLETED`, `CLOSED`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `created_at`, `created_by_id`, `description`, `description_html`, `end_date`, `id`, `label_ids`, `lead_id`, `logo_props`, `name`, `project_ids`, `start_date`, `state`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `lead`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    description_stripped: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Description stripped.',
    },
    v1_logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Logo props.',
    },
    archived_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Archived at.',
    },
    created_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Created by.',
    },
    updated_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Updated by.',
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
              'name',
              'description',
              'description_html',
              'description_stripped',
              'start_date',
              'end_date',
              'v1_logo_props',
              'state',
              'archived_at',
              'created_by',
              'updated_by',
              'lead_id',
            ]
          : [
              'workspace_slug',
              'name',
              'description',
              'description_html',
              'end_date',
              'lead_id',
              'logo_props',
              'project_ids',
              'start_date',
              'state',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'name',
          'description',
          'description_html',
          'end_date',
          'lead_id',
          'logo_props',
          'project_ids',
          'start_date',
          'state',
          'fields',
          'expand',
          'description_stripped',
          'v1_logo_props',
          'archived_at',
          'created_by',
          'updated_by',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/`,
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
              description_html: { key: 'description_html', type: 'string', required: false },
              description_stripped: {
                key: 'description_stripped',
                type: 'string',
                required: false,
              },
              start_date: { key: 'start_date', type: 'string', required: false },
              end_date: { key: 'end_date', type: 'string', required: false },
              logo_props: { key: 'v1_logo_props', type: 'object', required: false },
              state: { key: 'state', type: 'string', required: false },
              archived_at: { key: 'archived_at', type: 'string', required: false },
              created_by: { key: 'created_by', type: 'string', required: false },
              updated_by: { key: 'updated_by', type: 'string', required: false },
              lead: { key: 'lead_id', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              description: { key: 'description', type: 'string', required: false },
              description_html: { key: 'description_html', type: 'string', required: false },
              end_date: { key: 'end_date', type: 'string', required: false },
              lead_id: { key: 'lead_id', type: 'string', required: false },
              logo_props: { key: 'logo_props', type: 'string', required: false },
              project_ids: { key: 'project_ids', type: 'array', required: false },
              start_date: { key: 'start_date', type: 'string', required: false },
              state: { key: 'state', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Initiatives26c543Schema)
      : planeObjectResponse(response, planeV2Initiatives26c543Schema),
  outputs: { result: PLANEV2INITIATIVES26C543_OUTPUT },
}
