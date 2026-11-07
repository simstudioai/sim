import { toRecord } from '@sim/utils/object'
import type {
  HiggsfieldDeleteRequestResponse,
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

export const higgsfieldDeleteRequestTool: ToolConfig<
  HiggsfieldRequestIdParams,
  HiggsfieldDeleteRequestResponse
> = {
  id: 'higgsfield_delete_request',
  name: 'Higgsfield Delete Request',
  description:
    "Immediately delete a finished Higgsfield request's output files, prompt, and parameters.",
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of a finished Higgsfield request',
    },
  },
  request: {
    url: (params) =>
      buildHiggsfieldUrl(`/requests/${safeUrlPathSegment(params.requestId.trim(), 'requestId')}`),
    method: 'DELETE',
    headers: (params) => higgsfieldHeaders(params.accessToken),
  },
  transformResponse: async (response, params) => {
    const data = toRecord(await response.json())
    const requestId =
      typeof data.request_id === 'string' ? data.request_id : (params?.requestId.trim() ?? '')
    return { success: true, output: { requestId, deleted: data.status === 'deleted' } }
  },
  outputs: {
    requestId: { type: 'string', description: 'ID of the deleted request' },
    deleted: { type: 'boolean', description: 'Whether the request data was deleted' },
  },
}
