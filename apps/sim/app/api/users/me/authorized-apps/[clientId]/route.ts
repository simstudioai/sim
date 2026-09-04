import { revokeAuthorizedAppContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { revokeAuthorizedAppUseCase } from '@/lib/users/application/authorized-apps'
import { userAccountOperations } from '@/lib/users/application/operations'

export const dynamic = 'force-dynamic'

export const DELETE = defineInternalJsonRoute({
  contract: revokeAuthorizedAppContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.revokeAuthorizedApp,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated current-user settings mutation',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ clientId: params.clientId }),
  useCase: revokeAuthorizedAppUseCase,
  present: () => ({ success: true as const }),
})
