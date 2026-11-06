/**
 * @vitest-environment jsdom
 *
 * Failure modes at Home's read boundary: a workspace list still on its way reading as a viewer with
 * no workspaces.
 */
import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: () => false,
}))
vi.mock('@/platform/lib/data/integrations', () => ({
  useIntegrationActions: () => ({
    connecting: false,
    connect: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

import { useLiveHome } from '@/platform/lib/data/home'
import { renderDataHook, unmountDataHooks } from '@/platform/lib/render-hook.test-support'
import { useOrganizationHomeStore } from '@/stores/organization-home/store'

const ORGANIZATION = {
  organization: { id: 'org-1', name: 'Org', logo: null },
  viewer: { isAdmin: false, canConnectSearchIntegrations: true, canUseSearchMcp: false },
  searchAccess: { memberScoped: true },
  connectedAccountsAvailable: true,
  settingsFeatures: { hosted: true, billingEnabled: true },
}

const ACCOUNTS = {
  credentialGroup: null,
  assistantProviders: ['gmail', 'google-calendar'],
  availableProviders: ['google-email', 'google-calendar'],
  availableMcpConnectors: [],
  viewerMcpAccounts: [],
  viewerAccounts: [
    {
      credentialId: 'mail',
      displayName: 'mail@example.com',
      providerId: 'google-email',
      groupId: 'group',
      optionId: 'option',
      status: 'active',
    },
    {
      credentialId: 'calendar',
      displayName: 'calendar@example.com',
      providerId: 'google-calendar',
      groupId: 'group',
      optionId: 'option',
      status: 'active',
    },
  ],
}

const RESPONSES: Record<string, unknown> = {
  '/api/organizations/[id]/connected-accounts': ACCOUNTS,
  '/api/knowledge/sim-search/integrations': { data: [] },
  '/api/organizations/[id]/search/history': { sources: [] },
  '/api/mothership/chats': { data: [] },
  '/api/workspaces': {
    workspaces: [{ id: 'ws-1', name: 'One', organizationId: 'org-1' }],
    pinnedWorkspaceIds: [],
  },
  '/api/organizations/[id]/home/email': { accounts: [], threads: [] },
  '/api/organizations/[id]/home/calendar': {
    accounts: [],
    events: [],
    window: { startAt: '2026-11-05T00:00:00.000Z', endAt: '2026-11-06T00:00:00.000Z' },
  },
  '/api/organizations/[id]/home/workspace-activity': { workspaces: [] },
}

function setSession(session: { user: { id: string } } | null, isPending = false) {
  authClientMockFns.mockUseSession.mockReturnValue({ data: session, isPending })
}

function render() {
  return renderDataHook(() => useLiveHome(false))
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('useLiveHome', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    useOrganizationHomeStore.setState({ hiddenWidgets: {} })
    organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue(ORGANIZATION)
    apiClientRequestMockFns.mockRequestJson.mockImplementation(
      async (contract: { path: string }) => RESPONSES[contract.path] ?? {}
    )
  })
  afterEach(async () => {
    await unmountDataHooks()
    vi.useRealTimers()
  })

  it('shows workspaces as loading until the list answers, not as none', async () => {
    setSession({ user: { id: 'user-1' } })
    const answer: { resolve: (value: unknown) => void } = { resolve: () => {} }
    apiClientRequestMockFns.mockRequestJson.mockImplementation((contract: { path: string }) =>
      contract.path === '/api/workspaces'
        ? new Promise((resolve) => {
            answer.resolve = resolve
          })
        : Promise.resolve(RESPONSES[contract.path] ?? {})
    )
    const { result } = await render()
    await settle()

    expect(result.current.view.workspaces).toEqual({ status: 'loading' })

    await act(async () => answer.resolve({ workspaces: [], pinnedWorkspaceIds: [] }))
    await settle()

    expect(result.current.view.workspaces).toEqual({ status: 'ready', items: [] })
  })
})
