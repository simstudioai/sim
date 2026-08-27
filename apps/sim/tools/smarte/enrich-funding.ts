import { smarteHosting } from '@/tools/smarte/hosting'
import {
  SMARTE_CREDITS_DEDUCTED_OUTPUT,
  SMARTE_FUNDING_RECORDS_OUTPUT,
} from '@/tools/smarte/outputs'
import { normalizeFundingRecords, parseSmarteResponse } from '@/tools/smarte/response'
import type { SmarteEnrichFundingParams, SmarteEnrichFundingResponse } from '@/tools/smarte/types'
import type { ToolConfig } from '@/tools/types'

export const smarteEnrichFundingTool: ToolConfig<
  SmarteEnrichFundingParams,
  SmarteEnrichFundingResponse
> = {
  id: 'smarte_enrich_funding',
  name: 'SMARTe Enrich Funding',
  description: 'Retrieve funding and investment data for a company.',
  version: '1.0.0',

  hosting: smarteHosting<SmarteEnrichFundingParams>(),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SMARTe API key',
    },
    companyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SMARTe company identifier',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    companyWebsite: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website',
    },
    companyLinkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company LinkedIn profile URL',
    },
  },

  request: {
    url: 'https://api.smarte.pro/v8/enrich/funding',
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      companyId: params.companyId,
      companyName: params.companyName,
      companyWebsite: params.companyWebsite,
      companyLinkedinUrl: params.companyLinkedinUrl,
    }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: await parseSmarteResponse(response, 'funding', normalizeFundingRecords),
  }),

  outputs: {
    records: SMARTE_FUNDING_RECORDS_OUTPUT,
    creditsDeducted: SMARTE_CREDITS_DEDUCTED_OUTPUT,
  },
}
