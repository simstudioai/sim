/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCurrentUserSettings, mockExecute, mockAuthenticate } = vi.hoisted(() => ({
  mockGetCurrentUserSettings: vi.fn(),
  mockExecute: vi.fn(),
  mockAuthenticate: vi.fn(),
}))

vi.mock('@/lib/users/application/read-current-user', () => ({
  getCurrentUserSettingsUseCase: { execute: mockGetCurrentUserSettings },
}))

vi.mock('@/lib/credential-groups/application/manage-groups', () => ({
  getWorkspaceAccountsSettings: { execute: mockExecute },
}))

vi.mock('@/lib/api/server/routes/internal-json-route', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))
vi.mock('@/lib/api/server/routes', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))

import { SECTION_PREFETCHERS } from '@/app/workspace/[workspaceId]/settings/[section]/prefetch'
import { generalSettingsKeys } from '@/hooks/queries/current-user-data'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'

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

describe('credential-groups prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticate.mockResolvedValue({ kind: 'session', userId: 'u1', sessionId: 's1' })
  })

  it('hydrates the key the panel subscribes to, through the authorized use case', async () => {
    const credentialGroup = {
      id: 'g1',
      workspaceId: 'w1',
      name: 'Engineering',
      description: null,
      options: [],
      mcpServers: [],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mockExecute.mockResolvedValue({
      credentialGroup: { ...credentialGroup, internal: true },
      availableProviders: ['gmail'],
    })
    const queryClient = new QueryClient()

    await SECTION_PREFETCHERS['credential-groups']?.(queryClient, {
      workspaceId: 'w1',
    })

    expect(mockExecute).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'u1', sessionId: 's1' },
      input: { workspaceId: 'w1' },
    })
    expect(queryClient.getQueryData(credentialGroupKeys.workspace('w1'))).toEqual({
      credentialGroup,
      availableProviders: ['gmail'],
    })
  })

  it('leaves the cache empty when the use case denies the viewer', async () => {
    mockExecute.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' }))
    const queryClient = new QueryClient()

    await SECTION_PREFETCHERS['credential-groups']?.(queryClient, {
      workspaceId: 'w1',
    })

    expect(queryClient.getQueryData(credentialGroupKeys.workspace('w1'))).toBeUndefined()
  })

  it('leaves the cache empty when session authentication fails', async () => {
    mockAuthenticate.mockRejectedValue(new Error('unauthenticated'))
    const queryClient = new QueryClient()

    await SECTION_PREFETCHERS['credential-groups']?.(queryClient, {
      workspaceId: 'w1',
    })

    expect(mockExecute).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(credentialGroupKeys.workspace('w1'))).toBeUndefined()
  })
})
