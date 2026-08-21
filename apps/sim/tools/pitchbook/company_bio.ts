import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyBioTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_company_bio',
  name: 'PitchBook Company Bio',
  description:
    'Retrieve the core profile of a company: names, description, HQ, status, headcount, total raised, and social links',
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
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/bio`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch company bio')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        companyName: data.companyName ?? null,
        parentCompanyId: data.parentCompanyId ?? null,
        parentCompanyName: data.parentCompanyName ?? null,
        hqLocation: data.hqLocation ?? null,
        description: data.description ?? null,
        financingStatus: data.financingStatus ?? null,
        businessStatus: data.businessStatus ?? null,
        ownershipStatus: data.ownershipStatus ?? null,
        website: data.website ?? null,
        employees: data.employees ?? null,
        yearFounded: data.yearFounded ?? null,
        exchange: data.exchange ?? null,
        ticker: data.ticker ?? null,
        financingStatusNote: data.financingStatusNote ?? null,
        totalMoneyRaised: data.totalMoneyRaised ?? null,
        morningstarCode: data.morningstarCode ?? null,
        cikCode: data.cikCode ?? null,
        companySocialURLs: data.companySocialURLs ?? null,
        pitchBookProfileLink: data.pitchBookProfileLink ?? null,
        universe: data.universe ?? [],
        employeeHistory: data.employeeHistory ?? [],
        sicCodes: data.sicCodes ?? [],
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    companyName: {
      type: 'object',
      description: 'The names the company is known by',
      properties: {
        formalName: { type: 'string', description: 'Formal name', nullable: true },
        alsoKnownAs: { type: 'string', description: 'Also-known-as name', nullable: true },
        legalName: { type: 'string', description: 'Registered legal name', nullable: true },
        formerlyKnownAs: { type: 'string', description: 'Previous name', nullable: true },
      },
    },
    parentCompanyId: {
      type: 'string',
      description: 'PitchBook ID of the parent company',
      nullable: true,
    },
    parentCompanyName: {
      type: 'string',
      description: 'Name of the parent company',
      nullable: true,
    },
    hqLocation: {
      type: 'object',
      description: 'Headquarters location',
      nullable: true,
      properties: {
        city: { type: 'string', description: 'City', nullable: true },
        stateProvince: { type: 'string', description: 'State or province', nullable: true },
        postCode: { type: 'string', description: 'Postal code', nullable: true },
        country: { type: 'string', description: 'Country', nullable: true },
      },
    },
    description: { type: 'string', description: 'Business description', nullable: true },
    financingStatus: {
      type: 'object',
      description: 'How the company is financed',
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
    businessStatus: {
      type: 'object',
      description: 'Operating status of the business',
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
    ownershipStatus: {
      type: 'object',
      description: 'Ownership status of the company',
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
    universe: {
      type: 'array',
      description: 'PitchBook universes the company belongs to',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Universe code' },
          description: { type: 'string', description: 'Universe label' },
        },
      },
    },
    website: { type: 'string', description: 'Company website', nullable: true },
    employees: { type: 'number', description: 'Current employee count', nullable: true },
    employeeHistory: {
      type: 'array',
      description: 'Reported headcount over time',
      items: {
        type: 'object',
        properties: {
          asOfDate: { type: 'string', description: 'Date the count was reported (YYYY-MM-DD)' },
          employeeCount: { type: 'number', description: 'Headcount on that date' },
        },
      },
    },
    exchange: {
      type: 'string',
      description: 'Stock exchange the company trades on',
      nullable: true,
    },
    ticker: { type: 'string', description: 'Stock ticker', nullable: true },
    yearFounded: { type: 'number', description: 'Year the company was founded', nullable: true },
    financingStatusNote: {
      type: 'object',
      description: 'Analyst note explaining the financing status',
      nullable: true,
      properties: {
        note: { type: 'string', description: 'Note text', nullable: true },
        asOfDate: { type: 'string', description: 'Date of the note (YYYY-MM-DD)', nullable: true },
      },
    },
    totalMoneyRaised: {
      type: 'object',
      description: 'Total capital raised to date',
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
    sicCodes: {
      type: 'array',
      description: 'SIC classification codes',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'SIC code' },
          description: { type: 'string', description: 'SIC code label' },
        },
      },
    },
    morningstarCode: { type: 'string', description: 'Morningstar identifier', nullable: true },
    cikCode: { type: 'string', description: 'SEC CIK identifier', nullable: true },
    companySocialURLs: {
      type: 'object',
      description: 'Social profile links',
      nullable: true,
      properties: {
        facebookProfileUrl: { type: 'string', description: 'Facebook profile', nullable: true },
        twitterProfileUrl: { type: 'string', description: 'X/Twitter profile', nullable: true },
        linkedInProfileUrl: { type: 'string', description: 'LinkedIn profile', nullable: true },
      },
    },
    pitchBookProfileLink: {
      type: 'string',
      description: 'Link to the company profile in the PitchBook platform',
      nullable: true,
    },
  },
}
