import type { EmailBisonGetLeadParams, EmailBisonLeadResponse } from '@/tools/emailbison/types'
import {
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  leadOutputs,
  mapLead,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const getLeadTool: ToolConfig<EmailBisonGetLeadParams, EmailBisonLeadResponse> = {
  id: 'emailbison_get_lead',
  name: 'Email Bison Get Lead',
  description: 'Retrieves a lead by Email Bison lead ID or email address.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email Bison API token',
    },
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead ID or email address',
    },
  },
  request: {
    url: (params) => emailBisonUrl(`/api/leads/${encodeURIComponent(params.leadId.trim())}`),
    method: 'GET',
    headers: emailBisonHeaders,
  },
  transformResponse: async (response) => {
    const data = await emailBisonRecordData(response, 'lead')

    return {
      success: true,
      output: mapLead(data),
    }
  },
  outputs: leadOutputs,
}
