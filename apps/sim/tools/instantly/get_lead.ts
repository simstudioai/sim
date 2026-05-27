import type { InstantlyGetLeadParams, InstantlyLeadResponse } from '@/tools/instantly/types'
import {
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  leadOutputs,
  mapLead,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const getLeadTool: ToolConfig<InstantlyGetLeadParams, InstantlyLeadResponse> = {
  id: 'instantly_get_lead',
  name: 'Instantly Get Lead',
  description: 'Retrieves an Instantly V2 lead by ID.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead ID',
    },
  },
  request: {
    url: (params) => instantlyUrl(`/api/v2/leads/${params.leadId.trim()}`),
    method: 'GET',
    headers: instantlyHeaders,
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const lead = mapLead(data)

    return {
      success: true,
      output: {
        lead,
        id: lead.id,
        email_address: lead.email,
        first_name: lead.first_name,
        last_name: lead.last_name,
        campaign: lead.campaign,
        status: lead.status,
      },
    }
  },
  outputs: leadOutputs,
}
