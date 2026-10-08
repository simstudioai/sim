import type { PlaneDeleteWebhookParams, PlaneDeleteWebhookResponse } from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeDeleteWebhookTool: ToolConfig<
  PlaneDeleteWebhookParams,
  PlaneDeleteWebhookResponse
> = {
  id: 'plane_delete_webhook',
  name: 'Plane Delete a webhook',
  description: 'Delete a webhook in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook id.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/webhooks/${safeUrlPathSegment(params.pk, 'pk')}/`
      )
    },
    method: 'DELETE',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
