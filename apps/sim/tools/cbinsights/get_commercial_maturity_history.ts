import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export interface CbInsightsCommercialMaturityHistoryParams extends CbInsightsOrgParams {
  startDate?: string
  endDate?: string
}

export const cbinsightsGetCommercialMaturityHistoryTool: InternalToolConfig<
  CbInsightsCommercialMaturityHistoryParams,
  ToolResponse
> = {
  id: 'cbinsights_get_commercial_maturity_history',
  name: 'CB Insights Get Commercial Maturity History',
  description:
    "Retrieve an organization's historical Commercial Maturity levels, tracking how its ability to compete for customers or serve as a partner has moved over time.",
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
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Earliest date to return, as YYYY-MM-DD. Must be on or after 2024-07-25 and within 24 months of endDate. Defaults to the later of one year ago and 2024-07-25.',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Latest date to return, as YYYY-MM-DD. Must be on or after 2024-07-25 and within 24 months of startDate. Defaults to today.',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    commercialMaturityHistory: {
      type: 'json',
      description:
        'Maturity levels over time as [{asOfDate, level, stage, stageDescription}], where level runs 1-5',
    },
  },
}
