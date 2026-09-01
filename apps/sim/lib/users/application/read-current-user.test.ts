/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  getUserSettings: vi.fn(),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserProfile: mocks.getUserProfile,
  getUserSettings: mocks.getUserSettings,
}))

import { ForbiddenOperationError } from '@/lib/core/application'
import type { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getCurrentUserProfileUseCase,
  getCurrentUserSettingsUseCase,
} from '@/lib/users/application/read-current-user'

const session: SessionPrincipal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}
const personalKey: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}

describe('current-user reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('reads both resources for the authenticated account identity', async () => {
    const profile = { id: 'user-1', name: 'User', email: 'user@example.com', image: null }
    const settings = { theme: 'dark' }
    mocks.getUserProfile.mockResolvedValue(profile)
    mocks.getUserSettings.mockResolvedValue(settings)

    await expect(
      getCurrentUserProfileUseCase.execute({ principal: session, input: {} })
    ).resolves.toEqual(profile)
    await expect(
      getCurrentUserSettingsUseCase.execute({ principal: session, input: {} })
    ).resolves.toEqual(settings)
    expect(mocks.getUserProfile).toHaveBeenCalledWith('user-1')
    expect(mocks.getUserSettings).toHaveBeenCalledWith('user-1')
  })

  it('classifies a missing current-user profile as not found', async () => {
    mocks.getUserProfile.mockResolvedValue(null)

    await expect(
      getCurrentUserProfileUseCase.execute({ principal: session, input: {} })
    ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'not_found' })
  })
})
