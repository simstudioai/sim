import { PLANEGETWORKSPACEPAGEATTACHMENTRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeGetWorkspacePageAttachmentResultSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkspacePageAttachmentParams,
  PlaneGetWorkspacePageAttachmentResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeGetWorkspacePageAttachmentTool: ToolConfig<
  PlaneGetWorkspacePageAttachmentParams,
  PlaneGetWorkspacePageAttachmentResponse
> = {
  id: 'plane_get_workspace_page_attachment',
  name: 'Plane v1 only: Retrieve workspace page attachment metadata',
  description: 'v1 only: Retrieve workspace page attachment metadata in Plane. Requires API v1.',
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
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeGetWorkspacePageAttachmentResultSchema),
  outputs: { result: PLANEGETWORKSPACEPAGEATTACHMENTRESULT_OUTPUT },
}
