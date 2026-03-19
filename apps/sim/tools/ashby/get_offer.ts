import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetOfferParams {
  apiKey: string
  offerId: string
}

interface AshbyGetOfferResponse extends ToolResponse {
  output: {
    id: string
    offerStatus: string
    acceptanceStatus: string | null
    applicationId: string | null
    startDate: string | null
    salary: {
      currencyCode: string
      value: number
    } | null
    openingId: string | null
    createdAt: string | null
  }
}

export const getOfferTool: ToolConfig<AshbyGetOfferParams, AshbyGetOfferResponse> = {
  id: 'ashby_get_offer',
  name: 'Ashby Get Offer',
  description: 'Retrieves full details about a single offer by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    offerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the offer to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/offer.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      offerId: params.offerId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get offer')
    }

    const r = data.results
    const v = r.latestVersion

    return {
      success: true,
      output: {
        id: r.id ?? null,
        offerStatus: r.offerStatus ?? null,
        acceptanceStatus: r.acceptanceStatus ?? null,
        applicationId: r.applicationId ?? null,
        startDate: v?.startDate ?? null,
        salary: v?.salary
          ? {
              currencyCode: v.salary.currencyCode ?? null,
              value: v.salary.value ?? null,
            }
          : null,
        openingId: v?.openingId ?? null,
        createdAt: v?.createdAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Offer UUID' },
    offerStatus: {
      type: 'string',
      description: 'Offer status (e.g. WaitingOnCandidateResponse, CandidateAccepted)',
    },
    acceptanceStatus: {
      type: 'string',
      description: 'Acceptance status (e.g. Accepted, Declined, Pending)',
      optional: true,
    },
    applicationId: { type: 'string', description: 'Associated application UUID', optional: true },
    startDate: { type: 'string', description: 'Offer start date', optional: true },
    salary: {
      type: 'object',
      description: 'Salary details',
      optional: true,
      properties: {
        currencyCode: { type: 'string', description: 'ISO 4217 currency code' },
        value: { type: 'number', description: 'Salary amount' },
      },
    },
    openingId: { type: 'string', description: 'Associated opening UUID', optional: true },
    createdAt: {
      type: 'string',
      description: 'ISO 8601 creation timestamp (from latest version)',
      optional: true,
    },
  },
}
