import { getUserProfileContract, updateUserProfileContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { userAccountOperations } from '@/lib/users/application/operations'
import { updateCurrentUserProfile } from '@/lib/users/application/preferences'
import { getCurrentUserProfileUseCase } from '@/lib/users/application/read-current-user'

export const dynamic = 'force-dynamic'

export const PATCH = defineInternalJsonRoute({
  contract: updateUserProfileContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.updateProfile,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated current-user profile update' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: updateCurrentUserProfile,
  present: (user) => ({ success: true as const, user }),
})

export const GET = defineInternalJsonRoute({
  contract: getUserProfileContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.readProfile,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated current-user profile read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: getCurrentUserProfileUseCase,
  present: (userRecord) => ({ user: userRecord }),
})
