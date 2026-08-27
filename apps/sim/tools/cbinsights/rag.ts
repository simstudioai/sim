import type { CbInsightsAuthParams, CbInsightsRagResponse } from '@/tools/cbinsights/types'
import { asString, asStringArray, cbInsightsRequest } from '@/tools/cbinsights/utils'
import type { ToolConfig } from '@/tools/types'

interface CbInsightsRagParams extends CbInsightsAuthParams {
  message: string
}

export const cbinsightsRagTool: ToolConfig<CbInsightsRagParams, CbInsightsRagResponse> = {
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

  request: {
    url: () => '',
    method: 'POST',
    headers: () => ({}),
    /**
     * The message is the query CB Insights feeds to its own retrieval model —
     * the endpoint documentation states so directly — so an activated Sim
     * secret is projected to its canonical label before it leaves Sim.
     */
    modelInput: {
      mode: 'project',
      select: (params) => ({ message: params.message }),
    },
  },

  directExecution: async (params, signal) => {
    const message = params.message?.trim()
    if (!message) throw new Error('CB Insights "message" is required')
    if (message.length > 10_000) {
      throw new Error('CB Insights "message" must be under 10,000 characters')
    }

    return cbInsightsRequest<{ data?: unknown; guidance?: unknown }>(
      params,
      { path: '/v2/cbirag', body: { message } },
      (data) => ({ data: asString(data.data), guidance: asStringArray(data.guidance) }),
      signal
    )
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
