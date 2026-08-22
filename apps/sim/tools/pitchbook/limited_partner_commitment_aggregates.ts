import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerCommitmentAggregatesTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_limited_partner_commitment_aggregates',
  name: 'PitchBook Limited Partner Commitment Aggregates',
  description:
    'Retrieve a limited partner commitments rolled up by fund type, both active and all-time',
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
      description: 'PitchBook limited partner ID, e.g. 58901-50.',
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
    url: (params) =>
      `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/commitments-aggregates`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch limited partner commitment aggregates')
    const data = await response.json()

    return {
      success: true,
      output: {
        limitedPartnerId: data.limitedPartnerId ?? null,
        limitedPartnerName: data.limitedPartnerName ?? null,
        activeCommitmentsInDebtFunds: data.activeCommitmentsInDebtFunds ?? null,
        activeCommitmentsInPeFunds: data.activeCommitmentsInPeFunds ?? null,
        activeCommitmentsInReFunds: data.activeCommitmentsInReFunds ?? null,
        activeCommitmentsInVcFunds: data.activeCommitmentsInVcFunds ?? null,
        activeCommitmentsInFoFsAnd2nd: data.activeCommitmentsInFoFsAnd2nd ?? null,
        activeCommitmentsInInfrastructure: data.activeCommitmentsInInfrastructure ?? null,
        activeCommitmentsInEnergyFunds: data.activeCommitmentsInEnergyFunds ?? null,
        activeCommitmentsInOtherFunds: data.activeCommitmentsInOtherFunds ?? null,
        totalActiveCommitments: data.totalActiveCommitments ?? null,
        totalCommitmentsInDebtFunds: data.totalCommitmentsInDebtFunds ?? null,
        totalCommitmentsInPeFunds: data.totalCommitmentsInPeFunds ?? null,
        totalCommitmentsInReFunds: data.totalCommitmentsInReFunds ?? null,
        totalCommitmentsInVcFunds: data.totalCommitmentsInVcFunds ?? null,
        totalCommitmentsInFoFsAnd2nd: data.totalCommitmentsInFoFsAnd2nd ?? null,
        totalCommitmentsInInfrastructure: data.totalCommitmentsInInfrastructure ?? null,
        totalCommitmentsInEnergyFunds: data.totalCommitmentsInEnergyFunds ?? null,
        totalCommitmentsInOtherFunds: data.totalCommitmentsInOtherFunds ?? null,
        totalCommitments: data.totalCommitments ?? null,
      },
    }
  },

  outputs: {
    limitedPartnerId: {
      type: 'string',
      description: 'PitchBook limited partner ID',
      nullable: true,
    },
    limitedPartnerName: { type: 'string', description: 'Limited partner name', nullable: true },
    activeCommitmentsInDebtFunds: {
      type: 'json',
      description: 'Number of active commitments to debt funds',
      nullable: true,
    },
    activeCommitmentsInPeFunds: {
      type: 'number',
      description: 'Number of active commitments to PE funds',
      nullable: true,
    },
    activeCommitmentsInReFunds: {
      type: 'number',
      description: 'Number of active commitments to real estate funds',
      nullable: true,
    },
    activeCommitmentsInVcFunds: {
      type: 'number',
      description: 'Number of active commitments to VC funds',
      nullable: true,
    },
    activeCommitmentsInFoFsAnd2nd: {
      type: 'json',
      description: 'Number of active commitments to funds of funds and secondaries',
      nullable: true,
    },
    activeCommitmentsInInfrastructure: {
      type: 'json',
      description: 'Number of active commitments to infrastructure funds',
      nullable: true,
    },
    activeCommitmentsInEnergyFunds: {
      type: 'json',
      description: 'Number of active commitments to energy funds',
      nullable: true,
    },
    activeCommitmentsInOtherFunds: {
      type: 'number',
      description: 'Number of active commitments to other funds',
      nullable: true,
    },
    totalActiveCommitments: {
      type: 'number',
      description: 'Number of active commitments',
      nullable: true,
    },
    totalCommitmentsInDebtFunds: {
      type: 'json',
      description: 'Number of all commitments to debt funds',
      nullable: true,
    },
    totalCommitmentsInPeFunds: {
      type: 'number',
      description: 'Number of all commitments to PE funds',
      nullable: true,
    },
    totalCommitmentsInReFunds: {
      type: 'number',
      description: 'Number of all commitments to real estate funds',
      nullable: true,
    },
    totalCommitmentsInVcFunds: {
      type: 'number',
      description: 'Number of all commitments to VC funds',
      nullable: true,
    },
    totalCommitmentsInFoFsAnd2nd: {
      type: 'json',
      description: 'Number of all commitments to funds of funds and secondaries',
      nullable: true,
    },
    totalCommitmentsInInfrastructure: {
      type: 'json',
      description: 'Number of all commitments to infrastructure funds',
      nullable: true,
    },
    totalCommitmentsInEnergyFunds: {
      type: 'json',
      description: 'Number of all commitments to energy funds',
      nullable: true,
    },
    totalCommitmentsInOtherFunds: {
      type: 'number',
      description: 'Number of all commitments to other funds',
      nullable: true,
    },
    totalCommitments: {
      type: 'number',
      description: 'Number of commitments ever made',
      nullable: true,
    },
  },
}
