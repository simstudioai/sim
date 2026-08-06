import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadLeadByIdResponse } from '@/tools/smartlead/types'
import {
  leadRecordOutputs,
  mapLead,
  pathSegment,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetLeadByIdParams extends SmartleadBaseParams {
  leadId: number
}

export const getLeadByIdTool: ToolConfig<GetLeadByIdParams, SmartleadLeadByIdResponse> = {
  id: 'smartlead_get_lead_by_id',
  name: 'Smartlead Get Lead by ID',
  description: 'Looks up a Smartlead lead by its ID.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    leadId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Smartlead lead ID — the nested lead.id from List Campaign Leads, NOT campaign_lead_map_id',
    },
  },
  request: {
    url: (params) => smartleadUrl(`/leads/${pathSegment(params.leadId)}`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead')
    // This endpoint wraps the lead in a single-element `data` array.
    const rows = Array.isArray(record.data) ? record.data : []
    if (rows.length === 0) throw new Error('Smartlead lead not found')
    const lead = rows[0] as Record<string, unknown>

    return {
      success: true,
      output: {
        ...mapLead(lead),
        created_at: typeof lead.created_at === 'string' ? lead.created_at : null,
      },
    }
  },
  outputs: leadRecordOutputs,
}
