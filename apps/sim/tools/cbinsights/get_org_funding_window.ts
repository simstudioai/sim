import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetOrgFundingWindowTool: InternalToolConfig<
  CbInsightsOrgParams,
  ToolResponse
> = {
  id: 'cbinsights_get_org_funding_window',
  name: 'CB Insights Get Organization Funding Window',
  description:
    'Retrieve the estimated window in which an organization is likely to raise its next round, with the cohort it was compared against.',
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

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    windowStart: {
      type: 'string',
      nullable: true,
      description: 'Estimated start of the next funding window, as YYYY-MM-DD',
    },
    windowEnd: {
      type: 'string',
      nullable: true,
      description: 'Estimated end of the next funding window, as YYYY-MM-DD',
    },
    cohortNextRoundRate: {
      type: 'number',
      nullable: true,
      description:
        'Share of the cohort that historically raised another round, as a decimal between 0 and 1',
    },
    cohortCriteria: {
      type: 'json',
      nullable: true,
      description:
        'How the comparison cohort was defined: {cohortGeo, cohortRoundCategory, cohortLandscapes}',
    },
    latestFunding: {
      type: 'json',
      nullable: true,
      description: 'The latest equity-backed round: {date, dealId}',
    },
  },
}
