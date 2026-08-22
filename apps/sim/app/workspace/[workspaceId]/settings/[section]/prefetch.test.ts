/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserSettings, mockExecute, mockAuthenticate } = vi.hoisted(() => ({
  mockGetUserSettings: vi.fn(),
  mockExecute: vi.fn(),
  mockAuthenticate: vi.fn(),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserSettings: mockGetUserSettings,
}))

vi.mock('@/lib/credential-groups/application/manage-groups', () => ({
  listCredentialGroupSettings: { execute: mockExecute },
}))

vi.mock('@/lib/api/server/routes/internal-json-route', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))

import {
  prefetchGeneralSettings,
  SECTION_PREFETCHERS,
} from '@/app/workspace/[workspaceId]/settings/[section]/prefetch'
import { generalSettingsKeys } from '@/hooks/queries/general-settings'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'

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

describe('credential-groups prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticate.mockResolvedValue({ kind: 'session', userId: 'u1', sessionId: 's1' })
  })

  it('hydrates the key the panel subscribes to, through the authorized use case', async () => {
    mockExecute.mockResolvedValue({ credentialGroups: [{ id: 'g1' }] })
    const queryClient = new QueryClient()

    await SECTION_PREFETCHERS['credential-groups']?.(queryClient, {
      workspaceId: 'w1',
      userId: 'u1',
    })

    expect(mockExecute).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'u1', sessionId: 's1' },
      input: { workspaceId: 'w1' },
    })
    expect(queryClient.getQueryData(credentialGroupKeys.list('w1'))).toEqual([{ id: 'g1' }])
  })

  it('leaves the cache empty when the use case denies the viewer', async () => {
    // prefetchQuery swallows the rejection, so a denied viewer simply hydrates nothing and the
    // client fetch renders the real error rather than a poisoned cache entry.
    mockExecute.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' }))
    const queryClient = new QueryClient()

    await SECTION_PREFETCHERS['credential-groups']?.(queryClient, {
      workspaceId: 'w1',
      userId: 'u1',
    })

    expect(queryClient.getQueryData(credentialGroupKeys.list('w1'))).toBeUndefined()
  })
})
