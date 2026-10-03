import type { PersonalApiKeyPrincipal } from '@sim/auth/principal'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/users/queries', () => usersQueriesMock)

import { ForbiddenOperationError } from '@/lib/core/application'
import {
  getCurrentUserProfileUseCase,
  getCurrentUserSettingsUseCase,
} from '@/lib/users/application/read-current-user'

const mocks = {
  getUserProfile: usersQueriesMockFns.mockGetUserProfile,
  getUserSettings: usersQueriesMockFns.mockGetUserSettings,
}

const personalKey: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}

describe('current-user reads', () => {
  it('rejects non-session principals before loading account data', async () => {
    await expect(
      getCurrentUserProfileUseCase.execute({ principal: personalKey, input: {} })
    ).rejects.toBeInstanceOf(ForbiddenOperationError)
    await expect(
      getCurrentUserSettingsUseCase.execute({ principal: personalKey, input: {} })
    ).rejects.toBeInstanceOf(ForbiddenOperationError)
    expect(mocks.getUserProfile).not.toHaveBeenCalled()
    expect(mocks.getUserSettings).not.toHaveBeenCalled()
  })
})
