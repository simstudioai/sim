import type { CbInsightsAuthParams, CbInsightsRagResponse } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsRagParams extends CbInsightsAuthParams {
  message: string
}

export const cbinsightsRagTool: InternalToolConfig<CbInsightsRagParams, CbInsightsRagResponse> = {
  id: 'cbinsights_rag',
  name: 'CB Insights Retrieve Context',
  description:
    'Retrieve the raw structured CB Insights data relevant to a question, for feeding your own model rather than reading a written answer. Uses generative AI and can be wrong — verify anything that matters.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client ID, exchanged for a bearer token before each call',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client secret, exchanged for a bearer token before each call',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question to retrieve context for. Must be under 10,000 characters.',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
    modelInput: {
      mode: 'project',
      select: (params) => ({ message: params.message }),
    },
  },

  outputs: {
    data: {
      type: 'string',
      nullable: true,
      description:
        'Retrieved records as a JSON string, keyed by source (companySearch, dealSearch, markets, scoutingReports, businessRelationships, revenue, investments, and others)',
    },
    guidance: {
      type: 'json',
      description: 'Notes describing what each returned data source contains',
    },
  },
}
