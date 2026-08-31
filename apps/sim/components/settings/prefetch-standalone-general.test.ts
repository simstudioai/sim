/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticate, mockGetUserProfile, mockGetUserSettings } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockGetUserProfile: vi.fn(),
  mockGetUserSettings: vi.fn(),
}))

vi.mock('@/lib/api/server/routes', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))

vi.mock('@/lib/users/application/read-current-user', () => ({
  getCurrentUserProfileUseCase: { execute: mockGetUserProfile },
  getCurrentUserSettingsUseCase: { execute: mockGetUserSettings },
}))

import { prefetchStandaloneGeneral } from '@/components/settings/prefetch-standalone-general'
import { generalSettingsKeys } from '@/hooks/queries/general-settings'
import { userProfileKeys } from '@/hooks/queries/user-profile'

describe('prefetchStandaloneGeneral', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticate.mockResolvedValue({
      kind: 'session',
      userId: 'viewer-a',
      sessionId: 'session-a',
    })
    mockGetUserProfile.mockResolvedValue({
      id: 'viewer-a',
      name: 'Viewer',
      email: 'viewer@example.com',
      image: null,
      emailVerified: true,
    })
    mockGetUserSettings.mockResolvedValue({
      autoConnect: true,
      superUserModeEnabled: false,
      mothershipEnvironment: 'default',
      theme: 'dark',
      telemetryEnabled: true,
      billingUsageNotificationsEnabled: true,
      errorNotificationsEnabled: true,
      snapToGridSize: 0,
      showActionBar: true,
      autoFocusOnClick: true,
      copilotAutoAllowedTools: [],
      timezone: null,
    })
  })

  it('hydrates both exact General query entries for the authenticated viewer', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await prefetchStandaloneGeneral(queryClient)

    expect(mockAuthenticate).toHaveBeenCalledTimes(1)
    expect(mockGetUserProfile).toHaveBeenCalledWith({
      principal: expect.objectContaining({ userId: 'viewer-a' }),
      input: {},
    })
    expect(mockGetUserSettings).toHaveBeenCalledWith({
      principal: expect.objectContaining({ userId: 'viewer-a' }),
      input: {},
    })
    expect(queryClient.getQueryData(userProfileKeys.profile())).toEqual({
      id: 'viewer-a',
      name: 'Viewer',
      email: 'viewer@example.com',
      image: null,
    })
    expect(queryClient.getQueryData(generalSettingsKeys.settings())).toMatchObject({
      theme: 'dark',
      telemetryEnabled: true,
    })
  })

  it('keeps successful settings hydration when the profile is unavailable', async () => {
    mockGetUserProfile.mockResolvedValue(null)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await prefetchStandaloneGeneral(queryClient)

    expect(queryClient.getQueryData(userProfileKeys.profile())).toBeUndefined()
    expect(queryClient.getQueryData(generalSettingsKeys.settings())).toMatchObject({
      theme: 'dark',
    })
  })
})
