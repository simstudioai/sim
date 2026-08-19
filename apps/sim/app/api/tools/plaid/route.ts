import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { plaidOperationContract } from '@/lib/api/contracts/tools/plaid'
import {
  createInternalSessionOrExecutorAuth,
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  InternalUnauthenticatedError,
  internalErrorResponse,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCredentialDetailErrorPolicy } from '@/lib/credentials/api/route-policies'
import { CREDENTIAL_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { usePlaidServiceAccount } from '@/lib/credentials/application/use-plaid-service-account'
import { PlaidGatewayError, PlaidProviderError } from '@/tools/plaid/utils.server'

export const dynamic = 'force-dynamic'

const sessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: CREDENTIAL_DELEGATION_AUDIENCE,
})

const plaidExecutorAuth = {
  async authenticate(
    request: NextRequest,
    params: Record<string, string | string[] | undefined>
  ): Promise<WorkflowExecutionDelegatedPrincipal> {
    const principal = await sessionOrExecutorAuth.authenticate(request, params)
    if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
      throw new InternalUnauthenticatedError('Authentication required')
    }
    return principal
  },
}

const plaidErrorPolicy = extendInternalErrorPolicy(internalCredentialDetailErrorPolicy, (error) => {
  if (error instanceof PlaidProviderError) {
    return internalErrorResponse(error.status, error.body)
  }
  if (error instanceof PlaidGatewayError) {
    return internalErrorResponse(502, { error: error.message })
  }
  return null
})

export const POST = defineInternalJsonRoute({
  contract: plaidOperationContract,
  auth: plaidExecutorAuth,
  operation: credentialOperations.useServiceAccount,
  rateLimit: internalRateLimits.none({ reason: 'Executor-only provider proxy' }),
  errorPolicy: plaidErrorPolicy,
  parseOptions: { maxBodyBytes: 256 * 1024 },
  mapInput: ({ body }, { request }) => ({ body, signal: request.signal }),
  useCase: usePlaidServiceAccount,
})
