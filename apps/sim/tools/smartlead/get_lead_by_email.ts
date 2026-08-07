import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadLeadDetailResponse } from '@/tools/smartlead/types'
import {
  leadDetailOutputs,
  mapLeadDetail,
  smartleadBaseParamFields,
  smartleadExistingRecord,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetLeadByEmailParams extends SmartleadBaseParams {
  email: string
}

export const getLeadByEmailTool: ToolConfig<GetLeadByEmailParams, SmartleadLeadDetailResponse> = {
  id: 'smartlead_get_lead_by_email',
  name: 'Smartlead Get Lead by Email',
  description:
    'Looks up a Smartlead lead by email address and returns the lead record plus every campaign it belongs to.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead email address to look up',
    },
  },
  request: {
    url: (params) => smartleadUrl('/leads/', params.apiKey, { email: params.email }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadExistingRecord(response, 'lead', ['id', 'email'])

    return {
      success: true,
      output: mapLeadDetail(record),
    }
  },
  outputs: leadDetailOutputs,
}
