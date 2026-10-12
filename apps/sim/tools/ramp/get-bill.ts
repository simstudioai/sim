import type { RampGetBillParams, RampGetBillResponse } from '@/tools/ramp/types'
import { RAMP_BILL_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectBill } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetBillTool: ToolConfig<RampGetBillParams, RampGetBillResponse> = {
  id: 'ramp_get_bill',
  name: 'Ramp Get Bill',
  description: 'Fetch a bill in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    bill_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Bill id' },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/bills/${safeUrlPathSegment(params.bill_id, 'bill_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { bill: projectBill(data) } }
  },
  outputs: {
    bill: { type: 'json', description: 'Bill details', properties: RAMP_BILL_PROPERTIES },
  },
}
