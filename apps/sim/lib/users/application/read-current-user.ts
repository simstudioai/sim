import type { UserProfileApiUser, UserSettingsApi } from '@/lib/api/contracts/user'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireUserAccountPrincipal } from '@/lib/users/application/authorization'
import { userAccountOperations } from '@/lib/users/application/operations'
import { getUserProfile, getUserSettings } from '@/lib/users/queries'

export const getCurrentUserProfileUseCase: OperationUseCase<
  typeof userAccountOperations.readProfile,
  Record<string, never>,
  UserProfileApiUser
> = {
  operation: userAccountOperations.readProfile,
  async execute({ principal }) {
    requireUserAccountPrincipal(principal, userAccountOperations.readProfile)
    const profile = await getUserProfile(principal.userId)
    if (!profile) throw new OrchestrationError('not_found', 'User not found')
    return profile
  },
}

export const getCurrentUserSettingsUseCase: OperationUseCase<
  typeof userAccountOperations.readSettings,
  Record<string, never>,
  UserSettingsApi
> = {
  operation: userAccountOperations.readSettings,
  async execute({ principal }) {
    requireUserAccountPrincipal(principal, userAccountOperations.readSettings)
    return getUserSettings(principal.userId)
  },
}
