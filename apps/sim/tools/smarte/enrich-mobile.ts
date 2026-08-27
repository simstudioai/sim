import { smarteHosting } from '@/tools/smarte/hosting'
import {
  SMARTE_CREDITS_DEDUCTED_OUTPUT,
  SMARTE_MOBILE_RECORDS_OUTPUT,
} from '@/tools/smarte/outputs'
import { normalizeMobileRecords, parseSmarteResponse } from '@/tools/smarte/response'
import type { SmarteEnrichMobileParams, SmarteEnrichMobileResponse } from '@/tools/smarte/types'
import type { ToolConfig } from '@/tools/types'

export const smarteEnrichMobileTool: ToolConfig<
  SmarteEnrichMobileParams,
  SmarteEnrichMobileResponse
> = {
  id: 'smarte_enrich_mobile',
  name: 'SMARTe Enrich Mobile',
  description:
    'Retrieve direct dial and mobile phone fields without returning a full person profile.',
  version: '1.0.0',

  hosting: smarteHosting<SmarteEnrichMobileParams>(),

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
    experienceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SMARTe person experience identifier',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the person',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the person',
    },
    fullName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of the person',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Work email address',
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current job title',
    },
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
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
    url: 'https://api.smarte.pro/v8/enrich/mobile',
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      recordId: params.recordId,
      experienceId: params.experienceId,
      firstName: params.firstName,
      lastName: params.lastName,
      fullName: params.fullName,
      email: params.email,
      jobTitle: params.jobTitle,
      linkedinUrl: params.linkedinUrl,
      companyId: params.companyId,
      companyName: params.companyName,
      companyWebsite: params.companyWebsite,
      companyLinkedinUrl: params.companyLinkedinUrl,
    }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: await parseSmarteResponse(response, 'mobile', normalizeMobileRecords),
  }),

  outputs: {
    records: SMARTE_MOBILE_RECORDS_OUTPUT,
    creditsDeducted: SMARTE_CREDITS_DEDUCTED_OUTPUT,
  },
}
