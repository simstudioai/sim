import type { PlaneArchiveCycleParams, PlaneArchiveCycleResponse } from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeArchiveCycleTool: ToolConfig<PlaneArchiveCycleParams, PlaneArchiveCycleResponse> =
  {
    id: 'plane_archive_cycle',
    name: 'Plane v1 only: Archive a cycle',
    description: 'v1 only: Archive a cycle in Plane. Requires API v1.',
    version: '1.0.0',
    params: {
      ...PLANE_CREDENTIAL_PARAMS,
      cycle_id: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The unique identifier of the cycle.',
      },
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
    },
    request: {
      url: (params) => {
        return planeApiUrl(
          params.baseUrl,
          `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.cycle_id, 'cycle_id')}/archive/`
        )
      },
      method: 'POST',
      headers: (params) => planeHeaders(params.apiKey),
      redirectPolicy: planeRedirectPolicy,
    },
    transformResponse: async () => ({ success: true, output: { success: true } }),
    outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
  }
