import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookPersonEducationWorkTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_person_education_work',
  name: 'PitchBook Person Education and Work',
  description:
    'Retrieve a person full history: education, company roles, board seats, deal roles, and fund roles',
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
        'PitchBook person ID, e.g. 53503-66P. Person IDs end in P and come from a people search.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/people/${params.pbId.trim()}/education-work`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch person education and work history')
    const data = await response.json()

    return {
      success: true,
      output: {
        personId: data.personId ?? null,
        fullName: data.fullName ?? null,
        education: data.education ?? [],
        companyRoles: data.companyRoles ?? [],
        boardSeats: data.boardSeats ?? [],
        currentAdvisoryRoles: data.currentAdvisoryRoles ?? [],
        dealRoles: data.dealRoles ?? [],
        fundRoles: data.fundRoles ?? [],
      },
    }
  },

  outputs: {
    personId: { type: 'string', description: 'PitchBook person ID', nullable: true },
    fullName: { type: 'string', description: 'Full name of the person', nullable: true },
    education: {
      type: 'array',
      description: 'Institutions the person attended',
      items: {
        type: 'object',
        properties: {
          institution: { type: 'string', description: 'Institution name' },
          degree: { type: 'string', description: 'Degree earned', nullable: true },
          yearOfGraduation: { type: 'number', description: 'Graduation year', nullable: true },
        },
      },
    },
    companyRoles: {
      type: 'array',
      description: 'Positions the person has held at companies',
      items: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'PitchBook company ID' },
          companyName: { type: 'string', description: 'Company name' },
          position: { type: 'string', description: 'Position title', nullable: true },
          positionType: {
            type: 'string',
            description: 'Whether the role is an employee or non-employee position',
            nullable: true,
          },
          positionStatus: {
            type: 'string',
            description: 'Whether the position is Current or Former',
            nullable: true,
          },
          positionStart: {
            type: 'string',
            description: 'Date the position started (YYYY-MM-DD)',
            nullable: true,
          },
          positionFinish: {
            type: 'string',
            description: 'Date the position ended (YYYY-MM-DD)',
            nullable: true,
          },
        },
      },
    },
    boardSeats: {
      type: 'array',
      description: 'Board seats the person has held',
      items: {
        type: 'object',
        properties: {
          boardCompanyId: { type: 'string', description: 'PitchBook ID of the company' },
          boardCompanyName: { type: 'string', description: 'Name of the company' },
          boardRepresentingId: {
            type: 'string',
            description: 'PitchBook ID of the firm the seat represents',
            nullable: true,
          },
          boardRepresentingName: {
            type: 'string',
            description: 'Name of the firm the seat represents',
            nullable: true,
          },
          positionStatus: {
            type: 'string',
            description: 'Whether the seat is Current or Former',
            nullable: true,
          },
          boardStart: {
            type: 'string',
            description: 'Date the seat started (YYYY-MM-DD)',
            nullable: true,
          },
          boardFinish: {
            type: 'string',
            description: 'Date the seat ended (YYYY-MM-DD)',
            nullable: true,
          },
        },
      },
    },
    currentAdvisoryRoles: {
      type: 'array',
      description: 'Advisory roles the person currently holds',
      items: { type: 'object' },
    },
    dealRoles: {
      type: 'array',
      description: 'Deals the person worked on and who they represented',
      items: {
        type: 'object',
        properties: {
          dealId: { type: 'string', description: 'PitchBook deal ID' },
          dealDate: {
            type: 'string',
            description: 'Date of the deal (YYYY-MM-DD)',
            nullable: true,
          },
          companyId: { type: 'string', description: 'PitchBook ID of the company in the deal' },
          companyName: { type: 'string', description: 'Name of the company in the deal' },
          representingId: {
            type: 'string',
            description: 'PitchBook ID of the firm the person represented',
            nullable: true,
          },
          representingName: {
            type: 'string',
            description: 'Name of the firm the person represented',
            nullable: true,
          },
        },
      },
    },
    fundRoles: {
      type: 'array',
      description: 'Funds the person is associated with',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          fundName: { type: 'string', description: 'Fund name' },
          investorId: {
            type: 'string',
            description: 'PitchBook ID of the fund manager',
            nullable: true,
          },
          investorName: { type: 'string', description: 'Name of the fund manager', nullable: true },
          representingId: {
            type: 'string',
            description: 'PitchBook ID of the firm the person represented',
            nullable: true,
          },
          representingName: {
            type: 'string',
            description: 'Name of the firm the person represented',
            nullable: true,
          },
        },
      },
    },
  },
}
