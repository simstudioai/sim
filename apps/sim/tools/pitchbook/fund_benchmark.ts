import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundBenchmarkTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_fund_benchmark',
  name: 'PitchBook Fund Benchmark',
  description:
    'Retrieve the peer benchmark for a fund: benchmark IRR, DPI, TVPI, RVPI, and the funds it is drawn from',
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
      description: 'PitchBook fund ID, e.g. 11373-13F. Fund IDs end in F.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/benchmark`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund benchmark')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        fundName: data.fundName ?? null,
        benchmarkFundType: data.benchmarkFundType ?? null,
        benchmarkFundSize: data.benchmarkFundSize ?? null,
        benchmarkFundLocation: data.benchmarkFundLocation ?? null,
        benchmarkFundVintageYear: data.benchmarkFundVintageYear ?? null,
        irrBenchmark: data.irrBenchmark ?? null,
        dpiBenchmark: data.dpiBenchmark ?? null,
        tvpiBenchmark: data.tvpiBenchmark ?? null,
        rvpiBenchmark: data.rvpiBenchmark ?? null,
        numberOfFundsInBenchmark: data.numberOfFundsInBenchmark ?? null,
        benchmarkFunds: data.benchmarkFunds ?? [],
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    fundName: { type: 'string', description: 'Fund name', nullable: true },
    benchmarkFundType: {
      type: 'object',
      description: 'Fund type the benchmark is built from',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    benchmarkFundSize: {
      type: 'object',
      description: 'Fund size bucket the benchmark is built from',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    benchmarkFundLocation: {
      type: 'object',
      description: 'Location the benchmark is built from',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    benchmarkFundVintageYear: {
      type: 'number',
      description: 'Vintage year the benchmark is built from',
      nullable: true,
    },
    irrBenchmark: { type: 'number', description: 'Benchmark IRR', nullable: true },
    dpiBenchmark: { type: 'number', description: 'Benchmark DPI', nullable: true },
    tvpiBenchmark: { type: 'number', description: 'Benchmark TVPI', nullable: true },
    rvpiBenchmark: { type: 'number', description: 'Benchmark RVPI', nullable: true },
    numberOfFundsInBenchmark: {
      type: 'number',
      description: 'How many funds the benchmark is drawn from',
      nullable: true,
    },
    benchmarkFunds: {
      type: 'array',
      description: 'Funds making up the benchmark',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          fundName: { type: 'string', description: 'Fund name' },
        },
      },
    },
  },
}
