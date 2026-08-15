import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidExchangePublicTokenParams,
  PlaidExchangePublicTokenResponse,
} from '@/tools/plaid/types'
import { buildPlaidHeaders, plaidBaseParamFields, plaidRecord, plaidUrl } from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidExchangePublicTokenTool: ToolConfig<
  PlaidExchangePublicTokenParams,
  PlaidExchangePublicTokenResponse
> = {
  id: 'plaid_exchange_public_token',
  name: 'Plaid Exchange Public Token',
  description:
    'Exchange a public token from Plaid Link (or the sandbox) for a permanent access token and Item ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
    publicToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Public token returned by Plaid Link onSuccess (or the sandbox token creator)',
    },
  },

  request: {
    url: (params) => plaidUrl(params, '/item/public_token/exchange'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) => ({ public_token: params.publicToken.trim() }),
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'token exchange')
    return {
      success: true,
      output: {
        accessToken: typeof data.access_token === 'string' ? data.access_token : '',
        itemId: typeof data.item_id === 'string' ? data.item_id : '',
      },
    }
  },

  outputs: {
    accessToken: {
      type: 'string',
      description:
        'Access token for the linked Item; store it securely and pass it to the other Plaid operations',
    },
    itemId: { type: 'string', description: 'ID of the Item the token belongs to' },
  },
}
