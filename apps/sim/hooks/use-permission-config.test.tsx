/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, mockUseUserPermissionConfig } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockUseUserPermissionConfig: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/blocks/custom/client-overlay', () => ({ useCustomBlockOverlayVersion: () => 0 }))
vi.mock('@/blocks/visibility/context', () => ({
  overlayVisibility: () => null,
  isHiddenUnder: () => false,
}))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  useUserPermissionConfig: mockUseUserPermissionConfig,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => null,
}))
vi.mock('@/lib/permission-groups/model-access', () => ({ createModelAccessGate: () => () => true }))
vi.mock('@/lib/permission-groups/operation-access', () => ({
  createToolAccessGate: () => () => true,
}))

import type { GetAllowedIntegrationsResponse } from '@/lib/api/contracts/common'
import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { integrationAvailabilityKeys } from '@/hooks/queries/integration-availability'
import { type PermissionConfigResult, usePermissionConfig } from '@/hooks/use-permission-config'

const AVAILABILITY: GetAllowedIntegrationsResponse = {
  allowedIntegrations: null,
  integrationAvailability: [{ type: 'github_v2', state: 'ready', oauthAvailable: false }],
  oauthServiceAvailability: [{ providerId: 'github-repositories', available: false }],
}

describe('usePermissionConfig deployment readiness', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  let current: PermissionConfigResult

  function Probe() {
    current = usePermissionConfig()
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockUseUserPermissionConfig.mockReturnValue({ data: undefined, isLoading: false })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.useRealTimers()
  })

  function render() {
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    )
  }

  it('exposes an explicit pending state instead of implying that empty maps are ready', () => {
    mockRequestJson.mockReturnValue(new Promise(() => {}))
    render()
    expect(current!.isIntegrationAvailabilityLoading).toBe(true)
    expect(current!.isIntegrationAvailabilityReady).toBe(false)
    expect(current!.oauthServiceAvailability.size).toBe(0)
    expect(mockRequestJson).toHaveBeenCalledWith(getAllowedIntegrationsContract, {
      signal: expect.any(AbortSignal),
    })
  })

  it('keeps API-key workflow availability independent of its Search OAuth service', () => {
    queryClient.setQueryData(integrationAvailabilityKeys.environments(), AVAILABILITY)
    render()
    expect(current!.isIntegrationAvailabilityReady).toBe(true)
    expect(current!.isIntegrationAvailabilityLoading).toBe(false)
    expect(current!.oauthServiceAvailability.get('github-repositories')).toBe(false)
    expect(current!.isBlockAllowed('github_v2')).toBe(true)
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('offers requests only for group restrictions within the deployment allowlist', () => {
    mockUseUserPermissionConfig.mockReturnValue({
      data: { config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: [] } },
      isLoading: false,
    })
    queryClient.setQueryData(integrationAvailabilityKeys.environments(), {
      ...AVAILABILITY,
      allowedIntegrations: ['gmail'],
    })
    render()
    expect(current!.isBlockAllowed('gmail')).toBe(false)
    expect(current!.isBlockRequestable('gmail')).toBe(true)
    expect(current!.isBlockRequestable('slack')).toBe(false)
    expect(current!.isBlockRequestable('credential_group')).toBe(false)
  })

  it('does not offer a request before deployment availability resolves', () => {
    mockUseUserPermissionConfig.mockReturnValue({
      data: { config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: [] } },
      isLoading: false,
    })
    mockRequestJson.mockReturnValue(new Promise(() => {}))
    render()
    expect(current!.isBlockRequestable('gmail')).toBe(false)
  })

  it('surfaces a failed availability request and recovers through the same refetch action', async () => {
    const error = new Error('Unable to load deployment availability')
    mockRequestJson.mockRejectedValueOnce(error)
    render()
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(current!.integrationAvailabilityError).toBe(error)
    expect(current!.isIntegrationAvailabilityReady).toBe(false)
    expect(current!.isIntegrationAvailabilityLoading).toBe(false)

    mockRequestJson.mockResolvedValueOnce(AVAILABILITY)
    await act(async () => {
      await current!.refetchIntegrationAvailability()
      await vi.runOnlyPendingTimersAsync()
    })
    expect(current!.integrationAvailabilityError).toBeNull()
    expect(current!.isIntegrationAvailabilityReady).toBe(true)
    expect(current!.oauthServiceAvailability.get('github-repositories')).toBe(false)
  })

  it('does not treat cached readiness as successful after a failed refresh', async () => {
    queryClient.setQueryData(integrationAvailabilityKeys.environments(), {
      ...AVAILABILITY,
      oauthServiceAvailability: [{ providerId: 'github-repositories', available: true }],
    })
    render()
    expect(current!.isIntegrationAvailabilityReady).toBe(true)
    mockRequestJson.mockRejectedValueOnce(new Error('Network unavailable'))
    await act(async () => {
      await current!.refetchIntegrationAvailability()
      await vi.runOnlyPendingTimersAsync()
    })
    expect(current!.oauthServiceAvailability.get('github-repositories')).toBe(true)
    expect(current!.isIntegrationAvailabilityReady).toBe(false)
    expect(current!.integrationAvailabilityError?.message).toBe('Network unavailable')
  })
})
