import type {
  PlaneDownloadWorkspacePageAttachmentParams,
  PlaneDownloadWorkspacePageAttachmentResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeFileResponse,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDownloadWorkspacePageAttachmentTool: ToolConfig<
  PlaneDownloadWorkspacePageAttachmentParams,
  PlaneDownloadWorkspacePageAttachmentResponse
> = {
  id: 'plane_download_workspace_page_attachment',
  name: 'Plane v1 only: Download a workspace page attachment',
  description: 'v1 only: Download a workspace page attachment in Plane. Requires API v1.',
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
    responseType: 'binary',
    stripAuthOnRedirect: true,
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/${safeUrlPathSegment(params.page_id, 'page_id')}/attachments/${safeUrlPathSegment(params.attachment_id, 'attachment_id')}/download/`
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) => planeFileResponse(response),
  outputs: {
    file: { type: 'file', description: 'Downloaded attachment stored in execution files.' },
  },
}
