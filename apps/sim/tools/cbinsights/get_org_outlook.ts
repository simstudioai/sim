import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asRecord, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetOrgOutlookTool: ToolConfig<CbInsightsOrgParams, ToolResponse> = {
  id: 'cbinsights_get_org_outlook',
  name: 'CB Insights Get Organization Outlook',
  description:
    "Retrieve an organization's current Mosaic Score, Commercial Maturity level, and two-year IPO and M&A exit probabilities, with the signals driving each.",
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
    orgId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'CB Insights organization ID. Resolve a name or website to one with Look Up Organizations, which never charges credits.',
    },
  },

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) => {
    const orgId = requireOrgId(params.orgId)
    return cbInsightsRequest<{
      mosaicScore?: unknown
      commercialMaturity?: unknown
      exitProbability?: unknown
    }>(
      params,
      { path: `/v2/organizations/${orgId}/outlook` },
      (data) => ({
        mosaicScore: asRecord(data.mosaicScore),
        commercialMaturity: asRecord(data.commercialMaturity),
        exitProbability: asRecord(data.exitProbability),
      }),
      signal
    )
  },

  outputs: {
    mosaicScore: {
      type: 'json',
      nullable: true,
      description:
        'Mosaic Score on a 0-1000 scale: {overall, management, market, momentum, money}, each with scoreValue, asOfDate, and scoreInsights',
    },
    commercialMaturity: {
      type: 'json',
      nullable: true,
      description:
        'Commercial Maturity on a 1-5 scale: {maturityLevel: {level, stage, stageDescription, asOfDate}, commercialMaturitySignals}. Available only for a subset of companies.',
    },
    exitProbability: {
      type: 'json',
      nullable: true,
      description:
        'Two-year exit probability: {ipo, mna, exitSignals, incompleteRoundType}. A pending round zeroes the probabilities rather than omitting them.',
    },
  },
}
