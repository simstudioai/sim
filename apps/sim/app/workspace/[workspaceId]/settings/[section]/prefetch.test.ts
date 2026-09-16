/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCurrentUserSettings, mockAuthenticate } = vi.hoisted(() => ({
  mockGetCurrentUserSettings: vi.fn(),
  mockAuthenticate: vi.fn(),
}))

vi.mock('@/lib/users/application/read-current-user', () => ({
  getCurrentUserSettingsUseCase: { execute: mockGetCurrentUserSettings },
}))

vi.mock('@/lib/api/server/routes/internal-json-route', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))
vi.mock('@/lib/api/server/routes', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))

import { SECTION_PREFETCHERS } from '@/app/workspace/[workspaceId]/settings/[section]/prefetch'
import { generalSettingsKeys } from '@/hooks/queries/current-user-data'

describe('general settings prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticate.mockResolvedValue({ kind: 'session', userId: 'viewer-a', sessionId: 's1' })
  })

  it('hydrates through the current-user application operation and response contract', async () => {
    mockGetCurrentUserSettings.mockResolvedValue({
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

    await SECTION_PREFETCHERS.general?.(queryClient, { workspaceId: 'workspace-a' })

    expect(mockGetCurrentUserSettings).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'viewer-a', sessionId: 's1' },
      input: {},
    })
    expect(queryClient.getQueryData(generalSettingsKeys.settings())).toMatchObject({
      theme: 'system',
      telemetryEnabled: true,
    })
  })
})
