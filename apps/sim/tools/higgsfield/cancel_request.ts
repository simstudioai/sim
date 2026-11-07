import type {
  HiggsfieldCancelRequestResponse,
  HiggsfieldRequestIdParams,
} from '@/tools/higgsfield/types'
import {
  buildHiggsfieldUrl,
  higgsfieldAuthParams,
  higgsfieldHeaders,
  higgsfieldOAuth,
} from '@/tools/higgsfield/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const higgsfieldCancelRequestTool: ToolConfig<
  HiggsfieldRequestIdParams,
  HiggsfieldCancelRequestResponse
> = {
  id: 'higgsfield_cancel_request',
  name: 'Higgsfield Cancel Request',
  description:
    'Cancel a Higgsfield generation request that is still queued. Requests that have started processing cannot be canceled.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Higgsfield request ID to cancel',
    },
  },
  request: {
    url: (params) =>
      buildHiggsfieldUrl(
        `/requests/${safeUrlPathSegment(params.requestId.trim(), 'requestId')}/cancel`
      ),
    method: 'POST',
    headers: (params) => higgsfieldHeaders(params.accessToken),
  },
  transformResponse: async (_response, params) => {
    if (!params) throw new Error('Higgsfield cancel request requires request context')
    return { success: true, output: { requestId: params.requestId.trim(), canceled: true } }
  },
  outputs: {
    requestId: { type: 'string', description: 'ID of the canceled request' },
    canceled: { type: 'boolean', description: 'Whether the request was canceled' },
  },
}
