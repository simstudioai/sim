import { createLogger } from '@sim/logger'
import { deleteAccountContract, getAccountDeletionPlanContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { auth } from '@/lib/auth'
import {
  deleteAccountUseCase,
  previewAccountDeletionUseCase,
} from '@/lib/users/application/delete-account'
import { userAccountOperations } from '@/lib/users/application/operations'

const logger = createLogger('AccountDeletionRoute')

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
  /**
   * The session row is gone, but the signed cookie cache authenticates this
   * browser for up to five more minutes. Clear the cookies on the deletion
   * response itself so nothing the page does afterwards can carry them.
   */
  finalizeResponse: async ({ request }) => {
    try {
      const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true })
      return { headers }
    } catch (error) {
      /** The account is gone either way; the client's own sign-out and full reload still drop the cookie. */
      logger.warn('Could not clear session cookies after account deletion', { error })
      return {}
    }
  },
})
