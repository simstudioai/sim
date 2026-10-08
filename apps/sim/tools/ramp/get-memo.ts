import type { RampGetMemoParams, RampGetMemoResponse } from '@/tools/ramp/types'
import { RAMP_MEMO_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectMemo } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetMemoTool: ToolConfig<RampGetMemoParams, RampGetMemoResponse> = {
  id: 'ramp_get_memo',
  name: 'Ramp Get Memo',
  description: 'Fetch a transaction memo in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    transaction_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction id',
    },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/memos/${safeUrlPathSegment(params.transaction_id, 'transaction_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { memo: projectMemo(data) } }
  },
  outputs: {
    memo: { type: 'json', description: 'Memo details', properties: RAMP_MEMO_PROPERTIES },
  },
}
