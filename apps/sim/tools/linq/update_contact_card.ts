import type { LinqContactCardResult, LinqUpdateContactCardParams } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqUpdateContactCardTool: ToolConfig<
  LinqUpdateContactCardParams,
  LinqContactCardResult
> = {
  id: 'linq_update_contact_card',
  name: 'Update Contact Card',
  description: 'Partially update an existing active contact card for a phone number',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number in E.164 format identifying the card to update',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New last name',
    },
    imageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New profile photo URL',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/contact_card?phone_number=${encodeURIComponent(params.phoneNumber.trim())}`,
    method: 'PATCH',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.firstName !== undefined) body.first_name = params.firstName
      if (params.lastName !== undefined) body.last_name = params.lastName
      if (params.imageUrl !== undefined) body.image_url = params.imageUrl
      return body
    },
  },

  transformResponse: async (response): Promise<LinqContactCardResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to update contact card'),
        output: { phoneNumber: '', firstName: '', lastName: null, imageUrl: null, isActive: false },
      }
    }

    return {
      success: true,
      output: {
        phoneNumber: data.phone_number ?? '',
        firstName: data.first_name ?? '',
        lastName: data.last_name ?? null,
        imageUrl: data.image_url ?? null,
        isActive: data.is_active ?? false,
      },
    }
  },

  outputs: {
    phoneNumber: { type: 'string', description: 'Phone number the card applies to' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name', optional: true },
    imageUrl: { type: 'string', description: 'Profile photo URL', optional: true },
    isActive: { type: 'boolean', description: 'Whether the card is active' },
  },
}
