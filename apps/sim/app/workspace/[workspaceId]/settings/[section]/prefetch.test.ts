/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

const { mockGetUserSettings } = vi.hoisted(() => ({
  mockGetUserSettings: vi.fn(),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserSettings: mockGetUserSettings,
}))

import { prefetchGeneralSettings } from '@/app/workspace/[workspaceId]/settings/[section]/prefetch'
import { generalSettingsKeys } from '@/hooks/queries/general-settings'

describe('prefetchGeneralSettings', () => {
  it('uses the authenticated viewer id supplied by the route', async () => {
    mockGetUserSettings.mockResolvedValue({
      autoConnect: true,
      superUserModeEnabled: false,
      mothershipEnvironment: 'prod',
      theme: 'system',
      telemetryEnabled: true,
      billingUsageNotificationsEnabled: true,
      errorNotificationsEnabled: true,
      snapToGridSize: 0,
      showActionBar: true,
      autoFocusOnClick: true,
      copilotAutoAllowedTools: [],
      timezone: null,
    })
    const queryClient = new QueryClient()

    await prefetchGeneralSettings(queryClient, 'viewer-a')

    expect(mockGetUserSettings).toHaveBeenCalledWith('viewer-a')
    expect(queryClient.getQueryData(generalSettingsKeys.settings())).toMatchObject({
      theme: 'system',
      telemetryEnabled: true,
    })
  })
})
