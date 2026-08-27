import { smarteHosting } from '@/tools/smarte/hosting'
import {
  SMARTE_CREDITS_DEDUCTED_OUTPUT,
  SMARTE_PERSON_RECORDS_OUTPUT,
} from '@/tools/smarte/outputs'
import { normalizePersonRecords, parseSmarteResponse } from '@/tools/smarte/response'
import type { SmarteEnrichPersonParams, SmarteEnrichPersonResponse } from '@/tools/smarte/types'
import type { ToolConfig } from '@/tools/types'

export const smarteEnrichPersonTool: ToolConfig<
  SmarteEnrichPersonParams,
  SmarteEnrichPersonResponse
> = {
  id: 'smarte_enrich_person',
  name: 'SMARTe Enrich Person',
  description:
    'Enrich a person with professional details, current and past experience, and associated company context.',
  version: '1.0.0',

  hosting: smarteHosting<SmarteEnrichPersonParams>(),

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
      description: 'Identifier for a specific experience',
    },
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'First name of the person',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Last name of the person',
    },
    fullName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full name of the person',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Business email address',
    },
    jobTitle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current job title',
    },
    linkedinUrl: {
      type: 'string',
      required: true,
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
    url: 'https://api.smarte.pro/v8/enrich/person',
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
    output: await parseSmarteResponse(response, 'person', normalizePersonRecords),
  }),

  outputs: {
    records: SMARTE_PERSON_RECORDS_OUTPUT,
    creditsDeducted: SMARTE_CREDITS_DEDUCTED_OUTPUT,
  },
}
