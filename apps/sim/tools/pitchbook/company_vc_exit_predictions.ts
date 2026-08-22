import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyVcExitPredictionsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_vc_exit_predictions',
  name: 'PitchBook VC Exit Predictions',
  description:
    'Retrieve PitchBook machine-learning exit predictions for a VC-backed company. Requires at least two funding rounds in the past six years.',
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
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/vc-exit-predictions`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch VC exit predictions')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        predictionDate: data.predictionDate ?? null,
        opportunityScore: data.opportunityScore ?? null,
        successClass: data.successClass ?? null,
        successProbability: data.successProbability ?? null,
        noexitProbability: data.noexitProbability ?? null,
        exitClass: data.exitClass ?? null,
        ipoProbability: data.ipoProbability ?? null,
        mergeracquisitionProbability: data.mergeracquisitionProbability ?? null,
        vcDealNumber: data.vcDealNumber ?? null,
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    predictionDate: {
      type: 'string',
      description: 'Date the prediction was generated (YYYY-MM-DD)',
      nullable: true,
    },
    opportunityScore: {
      type: 'number',
      description: 'PitchBook opportunity score',
      nullable: true,
    },
    successClass: {
      type: 'string',
      description: 'Predicted outcome class, such as Success',
      nullable: true,
    },
    successProbability: {
      type: 'number',
      description: 'Probability of a successful outcome, as a percentage',
      nullable: true,
    },
    noexitProbability: {
      type: 'number',
      description: 'Probability of no exit, as a percentage',
      nullable: true,
    },
    exitClass: {
      type: 'string',
      description: 'Most likely exit type, such as IPO or M&A',
      nullable: true,
    },
    ipoProbability: {
      type: 'number',
      description: 'Probability of an IPO exit, as a percentage',
      nullable: true,
    },
    mergeracquisitionProbability: {
      type: 'number',
      description: 'Probability of an M&A exit, as a percentage',
      nullable: true,
    },
    vcDealNumber: {
      type: 'number',
      description: 'Number of VC deals the prediction is based on',
      nullable: true,
    },
  },
}
