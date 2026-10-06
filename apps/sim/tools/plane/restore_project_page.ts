import type {
  PlaneRestoreProjectPageParams,
  PlaneRestoreProjectPageResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeRestoreProjectPageTool: ToolConfig<
  PlaneRestoreProjectPageParams,
  PlaneRestoreProjectPageResponse
> = {
  id: 'plane_restore_project_page',
  name: 'Plane v1 only: Restore a project page',
  description: 'v1 only: Restore a project page in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
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
      description: 'The project UUID.',
    },
    page_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The page UUID.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/pages/${safeUrlPathSegment(params.page_id, 'page_id')}/archive/`
      )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
