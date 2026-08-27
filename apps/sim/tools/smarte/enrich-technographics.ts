import { smarteHosting } from '@/tools/smarte/hosting'
import {
  SMARTE_CREDITS_DEDUCTED_OUTPUT,
  SMARTE_TECHNOGRAPHICS_RECORDS_OUTPUT,
} from '@/tools/smarte/outputs'
import { normalizeTechnographicsRecords, parseSmarteResponse } from '@/tools/smarte/response'
import type {
  SmarteEnrichTechnographicsParams,
  SmarteEnrichTechnographicsResponse,
} from '@/tools/smarte/types'
import type { ToolConfig } from '@/tools/types'

export const smarteEnrichTechnographicsTool: ToolConfig<
  SmarteEnrichTechnographicsParams,
  SmarteEnrichTechnographicsResponse
> = {
  id: 'smarte_enrich_technographics',
  name: 'SMARTe Enrich Technographics',
  description: 'Retrieve company technology stack data for segmentation and targeting.',
  version: '1.0.0',

  hosting: smarteHosting<SmarteEnrichTechnographicsParams>(),

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
    product: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Technology product name filter',
    },
    vendor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Technology vendor name filter',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Technology product category filter',
    },
  },

  request: {
    url: 'https://api.smarte.pro/v8/enrich/technographics',
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
      product: params.product,
      vendor: params.vendor,
      category: params.category,
    }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: await parseSmarteResponse(response, 'technographics', normalizeTechnographicsRecords),
  }),

  outputs: {
    records: SMARTE_TECHNOGRAPHICS_RECORDS_OUTPUT,
    creditsDeducted: SMARTE_CREDITS_DEDUCTED_OUTPUT,
  },
}
