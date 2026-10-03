import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export interface CbInsightsExitProbabilityHistoryParams extends CbInsightsOrgParams {
  startDate?: string
  endDate?: string
}

export const cbinsightsGetExitProbabilityHistoryTool: InternalToolConfig<
  CbInsightsExitProbabilityHistoryParams,
  ToolResponse
> = {
  id: 'cbinsights_get_exit_probability_history',
  name: 'CB Insights Get Exit Probability History',
  description:
    "Retrieve an organization's historical two-year IPO and M&A exit probabilities, each alongside the mean for comparable companies.",
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
        'Earliest date to return, as YYYY-MM-DD. Must be on or after 2025-02-25 and within 24 months of endDate. Defaults to the later of one year ago and 2025-02-25.',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Latest date to return, as YYYY-MM-DD. Must be on or after 2025-02-25 and within 24 months of startDate. Defaults to today.',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    ipo: {
      type: 'json',
      description:
        'IPO probability over time as [{asOfDate, exitProbability, meanProbability, ratioToMean}]',
    },
    mna: {
      type: 'json',
      description:
        'M&A probability over time as [{asOfDate, exitProbability, meanProbability, ratioToMean}]',
    },
    incompleteRoundType: {
      type: 'string',
      nullable: true,
      description:
        'An in-progress round, if any. A pending round zeroes every probability; a rumored round zeroes only the matching exit type.',
    },
  },
}
