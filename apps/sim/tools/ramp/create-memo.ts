import type { RampCreateMemoParams, RampCreateMemoResponse } from '@/tools/ramp/types'
import { RAMP_MEMO_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectMemo } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampCreateMemoTool: ToolConfig<RampCreateMemoParams, RampCreateMemoResponse> = {
  id: 'ramp_create_memo',
  name: 'Ramp Create Memo',
  description: 'Upload a new memo for a transaction in Ramp',
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
    memo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction memo text (maximum 255 characters)',
    },
    is_memo_recurring: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apply the memo to similar future transactions (deprecated by Ramp)',
    },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/memos/${safeUrlPathSegment(params.transaction_id, 'transaction_id')}`,
    method: 'POST',
    headers: (params) => buildRampHeaders(params.accessToken),
    body: (params) => {
      if (params.memo.length > 255) {
        throw new Error('memo must contain no more than 255 characters')
      }
      return {
        memo: params.memo,
        ...(params.is_memo_recurring !== undefined
          ? { is_memo_recurring: params.is_memo_recurring }
          : {}),
      }
    },
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { memo: projectMemo(data) } }
  },
  outputs: {
    memo: { type: 'json', description: 'Memo details', properties: RAMP_MEMO_PROPERTIES },
  },
}
