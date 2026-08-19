import { deleteAccountContract, getAccountDeletionPlanContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  deleteAccountUseCase,
  previewAccountDeletionUseCase,
} from '@/lib/users/application/delete-account'
import { userAccountOperations } from '@/lib/users/application/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getAccountDeletionPlanContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.previewDeletion,
  rateLimit: internalRateLimits.none({ reason: 'Read-only preview of the caller’s own account' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: previewAccountDeletionUseCase,
  present: (plan) => ({ plan }),
})

/**
 * `AccountDeletionBlockedError` classifies itself as a conflict, so the shared
 * orchestration policy renders a refused deletion as a 409 carrying the first
 * blocker's sentence. The dialog lists every blocker from the GET above; this
 * message covers only the race where one appears between the two calls.
 */
export const POST = defineInternalJsonRoute({
  contract: deleteAccountContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.delete,
  rateLimit: internalRateLimits.none({ reason: 'Guarded by the email confirmation it requires' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ confirmEmail: body.confirmEmail }),
  useCase: deleteAccountUseCase,
  present: () => ({ success: true as const }),
})
