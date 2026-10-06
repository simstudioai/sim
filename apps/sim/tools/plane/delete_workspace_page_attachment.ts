import type {
  PlaneDeleteWorkspacePageAttachmentParams,
  PlaneDeleteWorkspacePageAttachmentResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeleteWorkspacePageAttachmentTool: ToolConfig<
  PlaneDeleteWorkspacePageAttachmentParams,
  PlaneDeleteWorkspacePageAttachmentResponse
> = {
  id: 'plane_delete_workspace_page_attachment',
  name: 'Plane v1 only: Delete a workspace page attachment',
  description: 'v1 only: Delete a workspace page attachment in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    page_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The workspace page UUID.',
    },
    attachment_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The attachment asset UUID.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/${safeUrlPathSegment(params.page_id, 'page_id')}/attachments/${safeUrlPathSegment(params.attachment_id, 'attachment_id')}/`
      )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
