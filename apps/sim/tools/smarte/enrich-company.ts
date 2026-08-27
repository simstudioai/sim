import { smarteHosting } from '@/tools/smarte/hosting'
import {
  SMARTE_COMPANY_RECORDS_OUTPUT,
  SMARTE_CREDITS_DEDUCTED_OUTPUT,
} from '@/tools/smarte/outputs'
import { normalizeCompanyRecords, parseSmarteResponse } from '@/tools/smarte/response'
import type { SmarteEnrichCompanyParams, SmarteEnrichCompanyResponse } from '@/tools/smarte/types'
import type { ToolConfig } from '@/tools/types'

export const smarteEnrichCompanyTool: ToolConfig<
  SmarteEnrichCompanyParams,
  SmarteEnrichCompanyResponse
> = {
  id: 'smarte_enrich_company',
  name: 'SMARTe Enrich Company',
  description:
    'Enrich a company with firmographic, financial, corporate hierarchy, and geographic attributes.',
  version: '1.0.0',

  hosting: smarteHosting<SmarteEnrichCompanyParams>(),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SMARTe API key',
    },
    recordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Client-side reference identifier',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SMARTe company identifier',
    },
    companyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    companyWebsite: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company website',
    },
    companyLinkedinUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company LinkedIn profile URL',
    },
  },

  request: {
    url: 'https://api.smarte.pro/v8/enrich/company',
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      recordId: params.recordId,
      companyId: params.companyId,
      companyName: params.companyName,
      companyWebsite: params.companyWebsite,
      companyLinkedinUrl: params.companyLinkedinUrl,
    }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: await parseSmarteResponse(response, 'company', normalizeCompanyRecords),
  }),

  outputs: {
    records: SMARTE_COMPANY_RECORDS_OUTPUT,
    creditsDeducted: SMARTE_CREDITS_DEDUCTED_OUTPUT,
  },
}
