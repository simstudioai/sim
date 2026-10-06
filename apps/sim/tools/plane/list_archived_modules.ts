import { MODULEE68880_OUTPUT } from '@/tools/plane/outputs'
import { modulee68880Schema } from '@/tools/plane/schemas'
import type {
  PlaneListArchivedModulesParams,
  PlaneListArchivedModulesResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_PAGINATION_OUTPUT,
  planeApiUrl,
  planeHeaders,
  planeListResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeListArchivedModulesTool: ToolConfig<
  PlaneListArchivedModulesParams,
  PlaneListArchivedModulesResponse
> = {
  id: 'plane_list_archived_modules',
  name: 'Plane v1 only: List all archived modules',
  description: 'v1 only: List all archived modules in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the project.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for getting next set of results',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of related fields to expand in response',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields to include in response',
    },
    order_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Field to order results by. Prefix with '-' for descending order",
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default: 20, max: 100)',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/archived-modules/`,
        planeVersionedValues(params, {
          cursor: { key: 'cursor', type: 'string', required: false },
          expand: { key: 'expand', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
          order_by: { key: 'order_by', type: 'string', required: false },
          per_page: { key: 'per_page', type: 'integer', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeListResponse(response, modulee68880Schema, true, false),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: MODULEE68880_OUTPUT.type,
        description: MODULEE68880_OUTPUT.description,
        properties: MODULEE68880_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
    pagination: PLANE_PAGINATION_OUTPUT,
  },
}
