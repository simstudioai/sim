import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorBoardSeatsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_investor_board_seats',
  name: 'PitchBook Investor Board Seats',
  description:
    'Retrieve the board seats an investor holds and previously held across its portfolio',
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
      description: 'PitchBook investor ID, e.g. 58781-35.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/board-seats`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor board seats')
    const data = await response.json()

    return {
      success: true,
      output: {
        investorId: data.investorId ?? null,
        current: data.current ?? [],
        former: data.former ?? [],
      },
    }
  },

  outputs: {
    investorId: { type: 'string', description: 'PitchBook investor ID', nullable: true },
    current: {
      type: 'array',
      description: 'Current entries',
      items: {
        type: 'object',
        properties: {
          personId: { type: 'string', description: 'PitchBook person ID' },
          personName: { type: 'string', description: 'Full name of the person' },
          boardCompanyId: {
            type: 'string',
            description: 'PitchBook ID of the company the seat is on',
          },
          boardCompanyName: { type: 'string', description: 'Name of the company the seat is on' },
          onBoard: { type: 'boolean', description: 'Whether the person holds a board seat' },
          boardStartDate: { type: 'string', description: 'Date the seat started (YYYY-MM-DD)' },
          boardEndDate: {
            type: 'json',
            description: 'Date the seat ended (YYYY-MM-DD)',
            nullable: true,
          },
          role: { type: 'string', description: 'Role played' },
        },
      },
    },
    former: {
      type: 'array',
      description: 'Former team members',
      items: { type: 'json' },
    },
  },
}
