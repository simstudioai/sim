import { PLANEV2PROJECTVIEWS116A1A_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ProjectViews116a1aSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateProjectViewParams,
  PlaneUpdateProjectViewResponse,
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

export const planeUpdateProjectViewTool: ToolConfig<
  PlaneUpdateProjectViewParams,
  PlaneUpdateProjectViewResponse
> = {
  id: 'plane_update_project_view',
  name: 'Plane Update a project view',
  description: 'Update a project view in Plane. Requires API v2.',
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
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project view id.',
    },
    access: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can see this.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description.',
    },
    display_filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Saved display options — grouping, ordering and layout.',
    },
    display_properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The display properties.',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Saved filter set, in the same shape the list endpoints accept.',
    },
    is_locked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prevents further edits to the content.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    pql_filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The pql filters.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Manual ordering weight. Lower sorts first.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `archived_at`, `created_at`, `created_by_id`, `description`, `display_filters`, `display_properties`, `filters`, `id`, `is_locked`, `logo_props`, `name`, `owned_by_id`, `pql_filters`, `query`, `sort_order`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/views/${safeUrlPathSegment(params.pk, 'pk')}/`,
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
      planeVersionedValues(
        params,
        {
          access: { key: 'access', type: 'string', required: false },
          description: { key: 'description', type: 'string', required: false },
          display_filters: { key: 'display_filters', type: 'string', required: false },
          display_properties: { key: 'display_properties', type: 'string', required: false },
          filters: { key: 'filters', type: 'string', required: false },
          is_locked: { key: 'is_locked', type: 'boolean', required: false },
          logo_props: { key: 'logo_props', type: 'string', required: false },
          name: { key: 'name', type: 'string', required: false },
          pql_filters: { key: 'pql_filters', type: 'string', required: false },
          sort_order: { key: 'sort_order', type: 'number', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2ProjectViews116a1aSchema),
  outputs: { result: PLANEV2PROJECTVIEWS116A1A_OUTPUT },
}
