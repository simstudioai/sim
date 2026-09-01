import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealBioTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_bio',
  name: 'PitchBook Deal Bio',
  description:
    'Retrieve the summary of a deal: company, date, size, status, type, and which detail datasets are available for it',
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
        'PitchBook deal ID, e.g. 52721-65T. Deal IDs end in T and come from a deal search or a company deals lookup.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/bio`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal bio')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        dealNumber: data.dealNumber ?? null,
        companyId: data.companyId ?? null,
        companyName: data.companyName ?? null,
        dealAnnouncedDate: data.dealAnnouncedDate ?? null,
        dealDate: data.dealDate ?? null,
        dealSize: data.dealSize ?? null,
        dealSizeStatus: data.dealSizeStatus ?? null,
        dealStatus: data.dealStatus ?? null,
        dealType1: data.dealType1 ?? null,
        dealType2: data.dealType2 ?? null,
        dealType3: data.dealType3 ?? null,
        dealClass: data.dealClass ?? null,
        valuationAvailable: data.valuationAvailable ?? false,
        capTableAvailable: data.capTableAvailable ?? false,
        trancheInfoAvailable: data.trancheInfoAvailable ?? false,
        debtLenderInfoAvailable: data.debtLenderInfoAvailable ?? false,
      },
    }
  },

  outputs: {
    dealId: { type: 'string', description: 'PitchBook deal ID', nullable: true },
    dealNumber: {
      type: 'number',
      description: 'Sequence of this deal in the company financing history',
      nullable: true,
    },
    companyId: {
      type: 'string',
      description: 'PitchBook ID of the company in the deal',
      nullable: true,
    },
    companyName: { type: 'string', description: 'Name of the company in the deal', nullable: true },
    dealAnnouncedDate: {
      type: 'string',
      description: 'Date the deal was announced (YYYY-MM-DD)',
      nullable: true,
    },
    dealDate: { type: 'string', description: 'Date the deal closed (YYYY-MM-DD)', nullable: true },
    dealSize: {
      type: 'object',
      description: 'Size of the deal',
      nullable: true,
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency', nullable: true },
        currency: { type: 'string', description: 'Currency of amount', nullable: true },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
          nullable: true,
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount', nullable: true },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    dealSizeStatus: {
      type: 'string',
      description: 'Whether the deal size is actual or estimated',
      nullable: true,
    },
    dealStatus: {
      type: 'object',
      description: 'Status of the deal, such as Completed',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    dealType1: {
      type: 'object',
      description: 'Primary deal type',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    dealType2: {
      type: 'object',
      description: 'Secondary deal type, such as the round letter',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    dealType3: {
      type: 'object',
      description: 'Tertiary deal type',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    dealClass: {
      type: 'object',
      description: 'Deal class, such as Venture Capital',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    valuationAvailable: {
      type: 'boolean',
      description: 'Whether valuation data exists for this deal',
    },
    capTableAvailable: {
      type: 'boolean',
      description: 'Whether cap table history exists for this deal',
    },
    trancheInfoAvailable: {
      type: 'boolean',
      description: 'Whether tranche information exists for this deal',
    },
    debtLenderInfoAvailable: {
      type: 'boolean',
      description: 'Whether debt and lender information exists for this deal',
    },
  },
}
