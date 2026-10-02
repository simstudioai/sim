import {
  ANYMAILFINDER_API_BASE_URL,
  anymailFinderError,
  anymailFinderHeaders,
} from '@/tools/anymailfinder/hosting'
import type {
  AnymailFinderGetAccountParams,
  AnymailFinderGetAccountResponse,
} from '@/tools/anymailfinder/types'
import type { ToolConfig } from '@/tools/types'

export const getAccountTool: ToolConfig<
  AnymailFinderGetAccountParams,
  AnymailFinderGetAccountResponse
> = {
  id: 'anymailfinder_get_account',
  name: 'Anymail Finder Get Account',
  description: 'Retrieve the remaining credit balance of the authenticated account. Free.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Anymail Finder API Key',
    },
  },

  request: {
    url: `${ANYMAILFINDER_API_BASE_URL}/account`,
    method: 'GET',
    headers: (params) => anymailFinderHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        error: await anymailFinderError(response),
        output: { credits_left: 0, account_email: null },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        credits_left: data.credits_left ?? 0,
        account_email: data.email ?? null,
      },
    }
  },

  outputs: {
    credits_left: { type: 'number', description: 'Remaining credits on the account' },
    account_email: {
      type: 'string',
      description: 'Login email of the account owner',
      optional: true,
    },
  },
}
