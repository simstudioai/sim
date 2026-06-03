import type { LinqGetContactCardParams, LinqGetContactCardResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqGetContactCardTool: ToolConfig<
  LinqGetContactCardParams,
  LinqGetContactCardResult
> = {
  id: 'linq_get_contact_card',
  name: 'Get Contact Card',
  description: 'Retrieve contact cards, optionally filtered by phone number',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'E.164 phone number to filter by (omit to return all cards)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.phoneNumber) query.set('phone_number', params.phoneNumber)
      const qs = query.toString()
      return `${LINQ_API_BASE}/contact_card${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqGetContactCardResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to get contact card'),
        output: { contactCards: [] },
      }
    }

    return {
      success: true,
      output: {
        contactCards: (data.contact_cards ?? []).map((card: Record<string, unknown>) => ({
          phoneNumber: (card.phone_number as string) ?? '',
          firstName: (card.first_name as string) ?? '',
          lastName: (card.last_name as string | null) ?? null,
          imageUrl: (card.image_url as string | null) ?? null,
          isActive: (card.is_active as boolean) ?? false,
        })),
      },
    }
  },

  outputs: {
    contactCards: {
      type: 'array',
      description: 'Contact cards on the account',
      items: {
        type: 'object',
        properties: {
          phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name', optional: true },
          imageUrl: { type: 'string', description: 'Profile photo URL', optional: true },
          isActive: { type: 'boolean', description: 'Whether the card is active' },
        },
      },
    },
  },
}
