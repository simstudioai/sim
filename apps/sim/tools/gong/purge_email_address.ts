import type { GongPurgeEmailAddressParams, GongPurgeEmailAddressResponse } from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const purgeEmailAddressTool: ToolConfig<
  GongPurgeEmailAddressParams,
  GongPurgeEmailAddressResponse
> = {
  id: 'gong_purge_email_address',
  name: 'Gong Purge Email Address',
  description:
    'Erase all Gong data (calls, email messages, leads, contacts) referencing an email address. Asynchronous and irreversible.',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email address whose associated data should be permanently erased from Gong',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/data-privacy/erase-data-for-email-address')
      url.searchParams.set('emailAddress', params.emailAddress.trim())
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
      throw new Error(getGongErrorMessage(data, 'Failed to erase email address data'))
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
