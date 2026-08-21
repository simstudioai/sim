import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundPerformanceTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_fund_performance',
  name: 'PitchBook Fund Performance',
  description:
    'Retrieve the most recent reported returns for a fund: IRR, DPI, RVPI, TVPI, NAV, and benchmark quartile',
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
        'PitchBook fund ID, e.g. 11373-13F. Fund IDs end in F and come from a fund search.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/performance`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund performance')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        fundName: data.fundName ?? null,
        asOfQuarter: data.asOfQuarter ?? null,
        asOfYear: data.asOfYear ?? null,
        irr: data.irr ?? null,
        dpi: data.dpi ?? null,
        rvpi: data.rvpi ?? null,
        tvpi: data.tvpi ?? null,
        nav: data.nav ?? null,
        quartile: data.quartile ?? null,
        numberOfFundsInBenchmark: data.numberOfFundsInBenchmark ?? null,
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    fundName: { type: 'string', description: 'Fund name', nullable: true },
    asOfQuarter: {
      type: 'number',
      description: 'Quarter the figures are reported as of',
      nullable: true,
    },
    asOfYear: {
      type: 'number',
      description: 'Year the figures are reported as of',
      nullable: true,
    },
    irr: {
      type: 'number',
      description: 'Internal rate of return, as a percentage',
      nullable: true,
    },
    dpi: { type: 'number', description: 'Distributions to paid-in multiple', nullable: true },
    rvpi: { type: 'number', description: 'Residual value to paid-in multiple', nullable: true },
    tvpi: { type: 'number', description: 'Total value to paid-in multiple', nullable: true },
    nav: { type: 'number', description: 'Net asset value', nullable: true },
    quartile: {
      type: 'number',
      description: 'Benchmark quartile the fund falls in, 1 being the best',
      nullable: true,
    },
    numberOfFundsInBenchmark: {
      type: 'number',
      description: 'How many funds the benchmark is drawn from',
      nullable: true,
    },
  },
}
