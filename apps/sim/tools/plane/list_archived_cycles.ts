import { CYCLE8C1C16_OUTPUT } from '@/tools/plane/outputs'
import { cycle8c1c16Schema } from '@/tools/plane/schemas'
import type {
  PlaneListArchivedCyclesParams,
  PlaneListArchivedCyclesResponse,
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

export const planeListArchivedCyclesTool: ToolConfig<
  PlaneListArchivedCyclesParams,
  PlaneListArchivedCyclesResponse
> = {
  id: 'plane_list_archived_cycles',
  name: 'Plane v1 only: List all archived cycles',
  description: 'v1 only: List all archived cycles in Plane. Requires API v1.',
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
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/archived-cycles/`,
        planeVersionedValues(params, {
          cursor: { key: 'cursor', type: 'string', required: false },
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
    planeListResponse(response, cycle8c1c16Schema, true, false),
  outputs: {
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: CYCLE8C1C16_OUTPUT.type,
        description: CYCLE8C1C16_OUTPUT.description,
        properties: CYCLE8C1C16_OUTPUT.properties,
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
