import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidCreateSandboxPublicTokenParams,
  PlaidCreateSandboxPublicTokenResponse,
} from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  PLAID_BASE_URLS,
  plaidBody,
  plaidCredentialParamFields,
  plaidRecord,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidCreateSandboxPublicTokenTool: ToolConfig<
  PlaidCreateSandboxPublicTokenParams,
  PlaidCreateSandboxPublicTokenResponse
> = {
  id: 'plaid_create_sandbox_public_token',
  name: 'Plaid Create Sandbox Public Token',
  description:
    'Create a sandbox public token for a test institution without going through Plaid Link. Sandbox only — exchange the result for an access token to test other operations',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidCredentialParamFields,
    institutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Sandbox institution ID, e.g. 'ins_109508' (First Platypus Bank)",
    },
    initialProducts: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Comma-separated products to enable, e.g. 'transactions' or 'auth,identity'",
    },
    webhook: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Webhook URL to associate with the Item',
    },
  },

  request: {
    url: `${PLAID_BASE_URLS.sandbox}/sandbox/public_token/create`,
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) => {
      const options = plaidBody({ webhook: params.webhook?.trim() || undefined })
      return plaidBody({
        institution_id: params.institutionId.trim(),
        initial_products: splitPlaidList(params.initialProducts) ?? [],
        options: Object.keys(options).length > 0 ? options : undefined,
      })
    },
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'sandbox public token')
    return {
      success: true,
      output: {
        publicToken: typeof data.public_token === 'string' ? data.public_token : '',
      },
    }
  },

  outputs: {
    publicToken: {
      type: 'string',
      description: 'Sandbox public token to exchange for an access token',
    },
  },
}
