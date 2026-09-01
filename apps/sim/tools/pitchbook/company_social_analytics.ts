import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PitchbookCompanySocialAnalyticsParams,
  PitchbookResponse,
} from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanySocialAnalyticsTool: ToolConfig<
  PitchbookCompanySocialAnalyticsParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_social_analytics',
  name: 'PitchBook Company Social Analytics',
  description:
    'Retrieve web and social growth and size metrics for a company, with percentile ranks',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'PitchBook company ID, e.g. 10618-03. Use PitchBook Search to resolve a name to an ID.',
    },
    compare: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Benchmark the signals against a peer set: SIMILAR_COMPANIES, INDUSTRY, VERTICALS, or ALL_COMPANIES',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => {
      const qs = new URLSearchParams()
      if (params.compare) qs.set('compare', params.compare.trim())
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/social-analytics${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch company social analytics')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        growthRate: data.growthRate ?? null,
        growthRatePercentile: data.growthRatePercentile ?? null,
        growthRateChange: data.growthRateChange ?? null,
        growthRatePercentChange: data.growthRatePercentChange ?? null,
        webGrowthRate: data.webGrowthRate ?? null,
        webGrowthRatePercentile: data.webGrowthRatePercentile ?? null,
        socialGrowthRate: data.socialGrowthRate ?? null,
        socialGrowthRatePercentile: data.socialGrowthRatePercentile ?? null,
        sizeMultiple: data.sizeMultiple ?? null,
        sizeMultiplePercentile: data.sizeMultiplePercentile ?? null,
        sizeMultipleChange: data.sizeMultipleChange ?? null,
        sizeMultiplePercentChange: data.sizeMultiplePercentChange ?? null,
        webSizeMultiple: data.webSizeMultiple ?? null,
        webSizeMultiplePercentile: data.webSizeMultiplePercentile ?? null,
        socialSizeMultiple: data.socialSizeMultiple ?? null,
        socialSizeMultiplePercentile: data.socialSizeMultiplePercentile ?? null,
        twitterFollowers: data.twitterFollowers ?? null,
        twitterFollowersChange: data.twitterFollowersChange ?? null,
        twitterFollowersPercentChange: data.twitterFollowersPercentChange ?? null,
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    growthRate: { type: 'number', description: 'Overall growth rate', nullable: true },
    growthRatePercentile: {
      type: 'number',
      description: 'Percentile of the overall growth rate',
      nullable: true,
    },
    growthRateChange: {
      type: 'number',
      description: 'Change in the overall growth rate',
      nullable: true,
    },
    growthRatePercentChange: {
      type: 'number',
      description: 'Percent change in the overall growth rate',
      nullable: true,
    },
    webGrowthRate: { type: 'number', description: 'Web traffic growth rate', nullable: true },
    webGrowthRatePercentile: {
      type: 'number',
      description: 'Percentile of the web growth rate',
      nullable: true,
    },
    socialGrowthRate: {
      type: 'number',
      description: 'Social following growth rate',
      nullable: true,
    },
    socialGrowthRatePercentile: {
      type: 'number',
      description: 'Percentile of the social growth rate',
      nullable: true,
    },
    sizeMultiple: { type: 'number', description: 'Overall size multiple', nullable: true },
    sizeMultiplePercentile: {
      type: 'number',
      description: 'Percentile of the size multiple',
      nullable: true,
    },
    sizeMultipleChange: {
      type: 'number',
      description: 'Change in the size multiple',
      nullable: true,
    },
    sizeMultiplePercentChange: {
      type: 'number',
      description: 'Percent change in the size multiple',
      nullable: true,
    },
    webSizeMultiple: { type: 'number', description: 'Web size multiple', nullable: true },
    webSizeMultiplePercentile: {
      type: 'number',
      description: 'Percentile of the web size multiple',
      nullable: true,
    },
    socialSizeMultiple: { type: 'number', description: 'Social size multiple', nullable: true },
    socialSizeMultiplePercentile: {
      type: 'number',
      description: 'Percentile of the social size multiple',
      nullable: true,
    },
    twitterFollowers: { type: 'number', description: 'Twitter/X follower count', nullable: true },
    twitterFollowersChange: {
      type: 'number',
      description: 'Change in follower count',
      nullable: true,
    },
    twitterFollowersPercentChange: {
      type: 'number',
      description: 'Percent change in follower count',
      nullable: true,
    },
  },
}
