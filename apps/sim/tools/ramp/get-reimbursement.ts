import type { RampGetReimbursementParams, RampGetReimbursementResponse } from '@/tools/ramp/types'
import { RAMP_REIMBURSEMENT_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectReimbursement } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetReimbursementTool: ToolConfig<
  RampGetReimbursementParams,
  RampGetReimbursementResponse
> = {
  id: 'ramp_get_reimbursement',
  name: 'Ramp Get Reimbursement',
  description: 'Fetch a reimbursement in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    reimbursement_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reimbursement id',
    },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/reimbursements/${safeUrlPathSegment(params.reimbursement_id, 'reimbursement_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { reimbursement: projectReimbursement(data) } }
  },
  outputs: {
    reimbursement: {
      type: 'json',
      description: 'Reimbursement details',
      properties: RAMP_REIMBURSEMENT_PROPERTIES,
    },
  },
}
