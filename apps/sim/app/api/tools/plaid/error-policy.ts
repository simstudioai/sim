import { extendInternalErrorPolicy, internalErrorResponse } from '@/lib/api/server/routes'
import { internalCredentialDetailErrorPolicy } from '@/lib/credentials/api/route-policies'
import { PlaidGatewayError, PlaidProviderError } from '@/tools/plaid/utils.server'

export const plaidErrorPolicy = extendInternalErrorPolicy(
  internalCredentialDetailErrorPolicy,
  (error) => {
    if (error instanceof PlaidProviderError) {
      return internalErrorResponse(error.status, error.body)
    }
    if (error instanceof PlaidGatewayError) {
      return internalErrorResponse(502, { error: error.message })
    }
    return null
  }
)
