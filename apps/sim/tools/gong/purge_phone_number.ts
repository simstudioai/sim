import type { GongPurgePhoneNumberParams, GongPurgePhoneNumberResponse } from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const purgePhoneNumberTool: ToolConfig<
  GongPurgePhoneNumberParams,
  GongPurgePhoneNumberResponse
> = {
  id: 'gong_purge_phone_number',
  name: 'Gong Purge Phone Number',
  description:
    'Erase all Gong data (calls, leads, contacts) referencing a phone number. Asynchronous and irreversible.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Phone number whose associated data should be permanently erased from Gong. Must include a leading "+" and country code (e.g., +14255552671)',
    },
  },

  request: {
    url: (params) => {
      const phoneNumber = params.phoneNumber.trim()
      if (!phoneNumber.startsWith('+')) {
        throw new Error("phoneNumber must start with '+' followed by the country code")
      }
      const url = new URL('https://api.gong.io/v2/data-privacy/erase-data-for-phone-number')
      url.searchParams.set('phoneNumber', phoneNumber)
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to erase phone number data'))
    }
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
      optional: true,
    },
  },
}
