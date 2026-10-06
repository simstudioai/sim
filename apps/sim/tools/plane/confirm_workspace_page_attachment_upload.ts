import type {
  PlaneConfirmWorkspacePageAttachmentUploadParams,
  PlaneConfirmWorkspacePageAttachmentUploadResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeConfirmWorkspacePageAttachmentUploadTool: ToolConfig<
  PlaneConfirmWorkspacePageAttachmentUploadParams,
  PlaneConfirmWorkspacePageAttachmentUploadResponse
> = {
  id: 'plane_confirm_workspace_page_attachment_upload',
  name: 'Plane v1 only: Confirm a workspace page attachment upload',
  description: 'v1 only: Confirm a workspace page attachment upload in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
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
    is_uploaded: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the attachment was uploaded successfully. Defaults to `true`.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/${safeUrlPathSegment(params.page_id, 'page_id')}/attachments/${safeUrlPathSegment(params.attachment_id, 'attachment_id')}/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { is_uploaded: { key: 'is_uploaded', type: 'boolean', required: false } },
        params.bodyOverrides
      ),
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
