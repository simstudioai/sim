import type { PlaneDeleteModuleParams, PlaneDeleteModuleResponse } from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeleteModuleTool: ToolConfig<PlaneDeleteModuleParams, PlaneDeleteModuleResponse> =
  {
    id: 'plane_delete_module',
    name: 'Plane Delete a module',
    description: 'Delete a module in Plane. Supports API v1 compatibility.',
    version: '1.0.0',
    params: {
      ...PLANE_CREDENTIAL_PARAMS,
      apiVersion: PLANE_VERSION_PARAM,
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
        description: 'The module to delete.',
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
    },
    request: {
      url: (params) => {
        const version = planeApiVersion(params.apiVersion, true)
        assertPlaneVersionFields(
          params,
          version === 'v1'
            ? ['pk', 'project_id', 'workspace_slug']
            : ['workspace_slug', 'project_id', 'pk', 'fields', 'expand'],
          ['workspace_slug', 'project_id', 'pk', 'fields', 'expand'],
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
      method: 'DELETE',
      headers: (params) => planeHeaders(params.apiKey),
      redirectPolicy: planeRedirectPolicy,
    },
    transformResponse: async (_response, params) =>
      planeApiVersion(params?.apiVersion, true) === 'v1'
        ? { success: true, output: { success: true } }
        : { success: true, output: { success: true } },
    outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
  }
