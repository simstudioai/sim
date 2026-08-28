import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetScoutingReportTool: InternalToolConfig<
  CbInsightsOrgParams,
  ToolResponse
> = {
  id: 'cbinsights_get_scouting_report',
  name: 'CB Insights Get Scouting Report',
  description:
    'Generate an AI-written Scouting Report on a private company covering its business model, market position, strengths, and opportunities. Only active companies are eligible, and generation can take several minutes.',
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
        'CB Insights organization ID of an active company. Resolve a name or website to one with Look Up Organizations, which never charges credits.',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    orgInfo: {
      type: 'json',
      nullable: true,
      description:
        'Firmographics and proprietary scores for the company: {id, name, url, description, foundedYear, headcount, address, stage, totalFunding, lastFundingDate, overallMosaicScore, commercialMaturity}',
    },
    reportMarkdown: {
      type: 'string',
      nullable: true,
      description: 'The Scouting Report as Markdown, including citations',
    },
    reportJson: {
      type: 'string',
      nullable: true,
      description:
        'The Scouting Report as a JSON string. Citation links are not included in this form — use reportMarkdown when they matter.',
    },
  },
}
